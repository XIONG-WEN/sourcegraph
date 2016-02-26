package local

import (
	"bytes"
	"encoding/gob"
	"errors"
	"log"
	"strings"

	"github.com/golang/groupcache/lru"
	"github.com/rogpeppe/rog-go/parallel"
	"golang.org/x/net/context"
	"sourcegraph.com/sourcegraph/go-diff/diff"
	"src.sourcegraph.com/sourcegraph/go-sourcegraph/sourcegraph"
	"src.sourcegraph.com/sourcegraph/pkg/synclru"
	"src.sourcegraph.com/sourcegraph/pkg/vcs"
	"src.sourcegraph.com/sourcegraph/server/accesscontrol"
	"src.sourcegraph.com/sourcegraph/store"
	"src.sourcegraph.com/sourcegraph/svc"
)

var Deltas sourcegraph.DeltasServer = &deltas{
	cache: newDeltasCache(1e4), // ~1.5KB per gob encoded delta
}

type deltas struct {
	// mockDiffFunc, if set, is called by (deltas).diff instead of the
	// main method body. It allows mocking (deltas).diff in tests.
	mockDiffFunc func(context.Context, sourcegraph.DeltaSpec) ([]*diff.FileDiff, *sourcegraph.Delta, error)

	// cache caches get delta requests, does not cache results from
	// requests that return a non-nil error.
	cache *deltasCache
}

var _ sourcegraph.DeltasServer = (*deltas)(nil)

func (s *deltas) Get(ctx context.Context, ds *sourcegraph.DeltaSpec) (*sourcegraph.Delta, error) {
	if err := accesscontrol.VerifyUserHasReadAccess(ctx, "Deltas.Get", ds.Base.URI); err != nil {
		return nil, err
	}
	if err := accesscontrol.VerifyUserHasReadAccess(ctx, "Deltas.Get", ds.Head.URI); err != nil {
		return nil, err
	}

	if s.cache != nil {
		hit, ok := s.cache.Get(ds)
		if ok {
			return hit, nil
		}
	}

	d, err := s.fillDelta(ctx, &sourcegraph.Delta{Base: ds.Base, Head: ds.Head})
	if err != nil {
		return d, err
	}

	if s.cache != nil {
		s.cache.Add(ds, d)
	}
	return d, nil
}

func (s *deltas) fillDelta(ctx context.Context, d *sourcegraph.Delta) (*sourcegraph.Delta, error) {
	getRepo := func(repoSpec *sourcegraph.RepoSpec, repo **sourcegraph.Repo) error {
		var err error
		*repo, err = svc.Repos(ctx).Get(ctx, repoSpec)
		return err
	}
	getCommit := func(repoRevSpec *sourcegraph.RepoRevSpec, commit **vcs.Commit) error {
		var err error
		*commit, err = svc.Repos(ctx).GetCommit(ctx, repoRevSpec)
		repoRevSpec.CommitID = string((*commit).ID)
		return err
	}

	par := parallel.NewRun(4)
	if d.BaseRepo == nil {
		par.Do(func() error { return getRepo(&d.Base.RepoSpec, &d.BaseRepo) })
	}
	if d.HeadRepo == nil && d.Base.RepoSpec.URI != d.Head.RepoSpec.URI {
		par.Do(func() error { return getRepo(&d.Head.RepoSpec, &d.HeadRepo) })
	}
	if d.BaseCommit == nil {
		par.Do(func() error { return getCommit(&d.Base, &d.BaseCommit) })
	}
	if d.HeadCommit == nil {
		par.Do(func() error { return getCommit(&d.Head, &d.HeadCommit) })
	}
	if err := par.Wait(); err != nil {
		return d, err
	}

	// Try to compute merge-base.
	vcsBaseRepo, err := store.RepoVCSFromContext(ctx).Open(ctx, d.BaseRepo.URI)
	if err != nil {
		return d, err
	}

	if d.BaseRepo.URI != d.HeadRepo.URI {
		return d, errors.New("base and head repo must be identical")
	}
	d.HeadRepo = d.BaseRepo

	id, err := vcsBaseRepo.MergeBase(vcs.CommitID(d.BaseCommit.ID), vcs.CommitID(d.HeadCommit.ID))
	if err != nil {
		return d, err
	}

	if d.BaseCommit.ID != id {
		// There is most likely a merge conflict here, so we update the
		// delta to contain the actual merge base used in this diff A...B
		d.Base.CommitID = string(id)
		if strings.HasPrefix(d.Base.CommitID, d.Base.Rev) {
			// If the Revision is not a branch, but the commit ID, clear it.
			d.Base.Rev = ""
		}
		d.BaseCommit = nil
		d, err = s.fillDelta(ctx, d)
		if err != nil {
			return d, err
		}
	}
	return d, nil
}

type deltasCache struct {
	*synclru.Cache
}

func newDeltasCache(maxEntries int) *deltasCache {
	return &deltasCache{synclru.New(lru.New(maxEntries))}
}

func deltasCacheKey(spec *sourcegraph.DeltaSpec) string {
	return spec.Base.CommitID + ".." + spec.Head.CommitID
}

func (c *deltasCache) Add(spec *sourcegraph.DeltaSpec, delta *sourcegraph.Delta) {
	if spec.Base.CommitID == "" || spec.Head.CommitID == "" {
		return
	}
	buf := new(bytes.Buffer)
	enc := gob.NewEncoder(buf)
	if err := enc.Encode(delta); err != nil {
		log.Println("error while encoding delta:", err.Error())
		return
	}
	c.Cache.Add(deltasCacheKey(spec), buf.Bytes())
}

func (c *deltasCache) Get(spec *sourcegraph.DeltaSpec) (*sourcegraph.Delta, bool) {
	if spec.Base.CommitID == "" || spec.Head.CommitID == "" {
		return nil, false
	}
	obj, ok := c.Cache.Get(deltasCacheKey(spec))
	if !ok {
		return nil, false
	}
	deltaBytes, isBytes := obj.([]byte)
	if !isBytes {
		return nil, false
	}
	var copy *sourcegraph.Delta
	dec := gob.NewDecoder(bytes.NewReader(deltaBytes))
	if err := dec.Decode(&copy); err != nil {
		log.Println("error while decoding delta:", err.Error())
		return nil, false
	}
	return copy, true
}
