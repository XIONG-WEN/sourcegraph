import * as H from 'history'
import { Changeset } from '../../../../../../shared/src/graphql/schema'
import React from 'react'
import { ThemeProps } from '../../../../../../shared/src/theme'
import { Observer } from 'rxjs'
import { ExtensionsControllerProps } from '../../../../../../shared/src/extensions/controller'
import { Hoverifier } from '@sourcegraph/codeintellify'
import { RepoSpec, RevisionSpec, FileSpec, ResolvedRevisionSpec } from '../../../../../../shared/src/util/url'
import { HoverMerged } from '../../../../../../shared/src/api/client/types/hover'
import { ActionItemAction } from '../../../../../../shared/src/actions/ActionItem'
import { ExternalChangesetNode } from './ExternalChangesetNode'
import { HiddenExternalChangesetNode } from './HiddenExternalChangesetNode'

export interface ChangesetNodeProps extends ThemeProps {
    node: Changeset
    viewerCanAdminister: boolean
    campaignUpdates?: Pick<Observer<void>, 'next'>
    history: H.History
    location: H.Location
    extensionInfo?: {
        hoverifier: Hoverifier<RepoSpec & RevisionSpec & FileSpec & ResolvedRevisionSpec, HoverMerged, ActionItemAction>
    } & ExtensionsControllerProps
}

export const ChangesetNode: React.FunctionComponent<ChangesetNodeProps> = ({ node, ...props }) => {
    if (node.__typename === 'ExternalChangeset') {
        return <ExternalChangesetNode node={node} {...props} />
    }
    return <HiddenExternalChangesetNode node={node} {...props} />
}
