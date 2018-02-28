package main

import (
	"context"
	"fmt"
	"log"
	"runtime"

	log15 "gopkg.in/inconshreveable/log15.v2"

	"sourcegraph.com/sourcegraph/sourcegraph/pkg/api"
	"sourcegraph.com/sourcegraph/sourcegraph/pkg/slack"
)

func (n *notifier) slackNotify(ctx context.Context) {
	plural := ""
	if n.results.Data.Search.Results.ApproximateResultCount != "1" {
		plural = "s"
	}

	text := fmt.Sprintf(`*%s* new result%s found for saved search <%s|"%s">`,
		n.results.Data.Search.Results.ApproximateResultCount,
		plural,
		searchURL(n.newQuery, utmSourceSlack),
		n.query.Description,
	)
	slackNotify(ctx, n.orgsToNotify, text)
	logEvent("", "SavedSearchSlackNotificationSent", "results")
}

func slackNotifyCreated(ctx context.Context, orgsToNotify []int32, query api.SavedQuerySpecAndConfig) {
	if len(orgsToNotify) == 0 {
		return
	}

	text := fmt.Sprintf(`Notifications for the new saved search <%s|"%s"> will be sent here when new results are available.`,
		searchURL(query.Config.Query, utmSourceSlack),
		query.Config.Description,
	)
	slackNotify(ctx, orgsToNotify, text)
	logEvent("", "SavedSearchSlackNotificationSent", "created")
}

func slackNotifyDeleted(ctx context.Context, orgsToNotify []int32, query api.SavedQuerySpecAndConfig) {
	if len(orgsToNotify) == 0 {
		return
	}

	text := fmt.Sprintf(`Saved search <%s|"%s"> has been deleted.`,
		searchURL(query.Config.Query, utmSourceSlack),
		query.Config.Description,
	)
	slackNotify(ctx, orgsToNotify, text)
	logEvent("", "SavedSearchSlackNotificationSent", "deleted")
}

func slackNotifySubscribed(ctx context.Context, orgsToNotify []int32, query api.SavedQuerySpecAndConfig) {
	if len(orgsToNotify) == 0 {
		return
	}

	text := fmt.Sprintf(`Slack notifications enabled for the saved search <%s|"%s">. Notifications will be sent here when new results are available.`,
		searchURL(query.Config.Query, utmSourceSlack),
		query.Config.Description,
	)
	slackNotify(ctx, orgsToNotify, text)
	logEvent("", "SavedSearchSlackNotificationSent", "enabled")
}

func slackNotifyUnsubscribed(ctx context.Context, orgsToNotify []int32, query api.SavedQuerySpecAndConfig) {
	if len(orgsToNotify) == 0 {
		return
	}

	text := fmt.Sprintf(`Slack notifications for the saved search <%s|"%s"> disabled.`,
		searchURL(query.Config.Query, utmSourceSlack),
		query.Config.Description,
	)
	slackNotify(ctx, orgsToNotify, text)
	logEvent("", "SavedSearchSlackNotificationSent", "disabled")
}

func slackNotify(ctx context.Context, orgsToNotify []int32, text string) {
	webhooks, err := api.InternalClient.OrgsGetSlackWebhooks(ctx, orgsToNotify)
	if err != nil {
		log15.Error("slack notify: failed to get webhooks", "error", err)
		return
	}

	payload := &slack.Payload{
		Username:    "saved-search-bot",
		IconEmoji:   ":mag:",
		UnfurlLinks: false,
		UnfurlMedia: false,
		Text:        text,
	}

	for _, webhook := range webhooks {
		webhook := webhook
		if webhook == nil {
			continue // org does not have one set
		}
		go func() {
			if r := recover(); r != nil {
				// Same as net/http
				const size = 64 << 10
				buf := make([]byte, size)
				buf = buf[:runtime.Stack(buf, false)]
				log.Printf("slack notify: failed due to internal panic: %v\n%s", r, buf)
			}

			client := slack.New(webhook, true)
			err := slack.Post(payload, client.WebhookURL)
			if err != nil {
				log15.Error("slack notify: failed", "error", err)
			}
		}()
	}
}
