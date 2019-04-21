import * as comlink from '@sourcegraph/comlink'
import { Observable } from 'rxjs'
import uuid from 'uuid'
import { createExtensionHost as createInPageExtensionHost } from '../../../../shared/src/api/extension/worker'
import { EndpointPair } from '../../../../shared/src/platform/context'
import { wrapSMC } from '../../../../shared/src/util/comlink/stringMessageChannel'
import { isInPage } from '../context'

/**
 * Returns an observable of a communication channel to an extension host.
 *
 * When executing in-page (for example as a Phabricator plugin), this simply
 * creates an extension host worker and emits the returned EndpointPair.
 *
 * When executing in the browser extension, we create pair of chrome.runtime.Port objects,
 * named 'expose-{uuid}' and 'proxy-{uuid}', and return the ports wrapped using ${@link endpointFromPort}.
 *
 * The background script will listen to newly created ports, create an extension host
 * worker per pair of ports, and forward messages between the port objects and
 * the extension host worker's endpoints.
 */
export function createExtensionHost(): Observable<EndpointPair> {
    if (isInPage) {
        return createInPageExtensionHost({ wrapEndpoints: false })
    }
    const id = uuid.v4()
    return new Observable(subscriber => {
        const proxyPort = chrome.runtime.connect({ name: `proxy-${id}` })
        const exposePort = chrome.runtime.connect({ name: `expose-${id}` })
        subscriber.next({
            proxy: endpointFromPort(proxyPort),
            expose: endpointFromPort(exposePort),
        })
        return () => {
            proxyPort.disconnect()
            exposePort.disconnect()
        }
    })
}

let els = 0

/**
 * Partially wraps a chrome.runtime.Port and returns a MessagePort created using
 * comlink's {@link MessageChannelAdapter}, so that the Port can be used
 * as a comlink Endpoint to transport messages between the content script and the extension host.
 *
 * It is necessary to wrap the port using MessageChannelAdapter because chrome.runtime.Port objects do not support
 * transfering MessagePort objects (see https://github.com/GoogleChromeLabs/comlink/blob/master/messagechanneladapter.md).
 *
 */
function endpointFromPort(
    port: chrome.runtime.Port
): Pick<MessagePort, 'postMessage' | 'addEventListener' | 'removeEventListener'> {
    const listeners = new Map<
        EventListenerOrEventListenerObject,
        (message: object, port: chrome.runtime.Port) => void
    >()
    return wrapSMC({
        send(data): void {
            port.postMessage(data)
        },
        addEventListener(event: 'message', messageListener: EventListenerOrEventListenerObject): void {
            if (event !== 'message') {
                return
            }

            els++
            console.log('Event listeners:', els)

            const chromePortListener = (data: object) => {
                // This callback is called *very* often (e.g., ~900 times per keystroke in a
                // monitored textarea). Avoid creating unneeded objects here because GC
                // significantly hurts perf. See
                // https://github.com/sourcegraph/sourcegraph/issues/3433#issuecomment-483561297 and
                // watch that issue for a (possibly better) fix.
                //
                // HACK: Use a simple object here instead of `new MessageEvent('message', { data })`
                // to reduce the amount of garbage created. There are no callers that depend on
                // other MessageEvent properties; they would be set to their default values anyway,
                // so losing the properties is not a big problem.
                const handler =
                    'handleEvent' in messageListener
                        ? messageListener.handleEvent.bind(messageListener)
                        : messageListener
                handler.call(this, { data } as any /* new MessageEvent('message', { data }) */)
            }
            listeners.set(messageListener, chromePortListener)
            port.onMessage.addListener(chromePortListener)
        },
        removeEventListener(event: 'message', messageListener: EventListenerOrEventListenerObject): void {
            if (event !== 'message') {
                return
            }
            const chromePortListener = listeners.get(messageListener)
            if (!chromePortListener) {
                console.error('chromePortListener not found!')
                return
            }

            els--
            console.log('(removed) Event listeners:', els)

            port.onMessage.removeListener(chromePortListener)
        },
    })
}
