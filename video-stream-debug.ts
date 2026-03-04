import { EventEmitter } from 'node:events';
// eslint-disable-next-line @typescript-eslint/naming-convention
import WebSocket, { Server } from 'ws';
import { Mpeg1Muxer, MuxerOptions } from './mpeg1-muxer';

interface StreamOptions extends Omit<MuxerOptions, 'url'> {
    wsPort?: number;
    url?: string;  // Make url available in StreamOptions
}

interface WebSocketMeta extends WebSocket.WebSocket {
    id: string;
    liveUrl: string;
}

// eslint-disable-next-line @typescript-eslint/no-type-alias
type MpegListener = (...args: Array<unknown>) => void;

function getUrl(url: string): string | null {
    try {
        const parsedUrl: URL = new URL(url, 'http://localhost');
        const extractedUrl = parsedUrl.searchParams.get('url');
        console.log(`[DEBUG] getUrl - Input: ${url}, Extracted: ${extractedUrl}`);
        return extractedUrl;
    } catch (error) {
        console.error(`[DEBUG] getUrl - Error parsing URL: ${url}`, error);
        return null;
    }
}

export class VideoStream extends EventEmitter {

    public liveMuxers: Map<string, Mpeg1Muxer> = new Map<string, Mpeg1Muxer>();

    private wsServer?: Server;

    private readonly options?: StreamOptions;

    private liveMuxerListeners: Map<string, MpegListener> = new Map<string, MpegListener>();

    public constructor(opt?: StreamOptions) {
        super();
        this.options = opt;
        console.log('[DEBUG] VideoStream constructor - Options:', JSON.stringify(opt, null, 2));

        process.on('beforeExit', () => {
            console.log('[DEBUG] Process beforeExit - Stopping VideoStream');
            this.stop();
        });
    }

    public start(): void {
        console.log('[DEBUG] start() - Starting WebSocket server on port:', this.options?.wsPort || 9999);
        console.log('[DEBUG] start() - Configured RTSP URL:', this.options?.url);
        this.wsServer = new Server({ port: this.options?.wsPort || 9999 });

        this.wsServer.on('connection', (socket, request) => {
            console.log('[DEBUG] WebSocket connection received');
            console.log('[DEBUG] Request URL:', request.url);
            console.log('[DEBUG] Request headers:', request.headers);

            if (!request.url) {
                console.warn('[DEBUG] No request URL - rejecting connection');
                return;
            }

            // Try to get URL from query parameter, fallback to configured URL
            let liveUrl: string | null = getUrl(request.url);

            if (!liveUrl && this.options?.url) {
                console.log('[DEBUG] No URL in query parameter, using configured URL:', this.options.url);
                liveUrl = this.options.url;
            }

            if (!liveUrl) {
                console.warn('[DEBUG] Could not extract liveUrl from request URL and no configured URL available');
                return;
            }

            console.info('Socket connected', request.url);
            console.log('[DEBUG] Using RTSP URL:', liveUrl);

            (socket as WebSocketMeta).id = Date.now().toString();
            (socket as WebSocketMeta).liveUrl = liveUrl;

            console.log('[DEBUG] Socket metadata:', {
                id: (socket as WebSocketMeta).id,
                liveUrl: (socket as WebSocketMeta).liveUrl
            });

            console.log('[DEBUG] Current liveMuxers:', Array.from(this.liveMuxers.keys()));
            console.log('[DEBUG] liveMuxers.has(liveUrl):', this.liveMuxers.has(liveUrl));

            if (this.liveMuxers.has(liveUrl)) {
                console.log('[DEBUG] Reusing existing muxer for:', liveUrl);
                const muxer: Mpeg1Muxer | undefined = this.liveMuxers.get(liveUrl);

                if (muxer) {
                    console.log('[DEBUG] Muxer found, attaching listener');
                    const listenerFunc: MpegListener = data => {
                        // console.log('[DEBUG] Sending mpeg1data to socket, size:', (data as Buffer).length);
                        socket.send(data as Buffer);
                    };
                    muxer.on('mpeg1data', listenerFunc);

                    const listenerKey = `${liveUrl}-${(socket as WebSocketMeta).id}`;
                    this.liveMuxerListeners.set(listenerKey, listenerFunc);
                    console.log('[DEBUG] Listener registered:', listenerKey);
                    console.log('[DEBUG] Total listeners for this muxer:', muxer.listenerCount('mpeg1data'));
                }
            } else {
                console.log('[DEBUG] Creating new muxer for:', liveUrl);
                console.log('[DEBUG] Muxer options:', { ...this.options, url: liveUrl });

                const muxer: Mpeg1Muxer = new Mpeg1Muxer({ ...this.options, url: liveUrl });
                this.liveMuxers.set(liveUrl, muxer);

                console.log('[DEBUG] New muxer created and stored');
                console.log('[DEBUG] Current liveMuxers count:', this.liveMuxers.size);

                muxer.on('liveErr', (errMsg: string | Buffer) => {
                    console.error('[DEBUG] Muxer liveErr event:', errMsg);
                    console.info('Error go live', errMsg);

                    socket.send(4104);

                    try {
                        // code should be in [4000,4999] ref https://tools.ietf.org/html/rfc6455#section-7.4.2
                        console.log('[DEBUG] Closing socket with code 4104');
                        socket.close(4104, errMsg);
                    } catch (error) {
                        console.error('[DEBUG] Error closing socket:', error);
                        socket.close(4104, 'fallbackclose');
                    }
                });

                const listenerFunc: MpegListener = data => {
                    // console.log('[DEBUG] Sending mpeg1data to socket (new muxer), size:', (data as Buffer).length);
                    socket.send(data as Buffer);
                };
                muxer.on('mpeg1data', listenerFunc);

                const listenerKey = `${liveUrl}-${(socket as WebSocketMeta).id}`;
                this.liveMuxerListeners.set(listenerKey, listenerFunc);
                console.log('[DEBUG] Listener registered for new muxer:', listenerKey);
            }

            socket.on('close', () => {
                console.info('Socket closed');
                console.log('[DEBUG] WebSocket clients remaining:', this.wsServer?.clients.size);

                if (this.wsServer?.clients.size == 0) {
                    console.log('[DEBUG] No clients remaining - cleaning up all muxers');

                    if (this.liveMuxers.size > 0) {
                        console.log('[DEBUG] Stopping', this.liveMuxers.size, 'muxers');
                        [...this.liveMuxers.values()].forEach(skt => { skt.stop(); });
                    }
                    this.liveMuxers = new Map<string, Mpeg1Muxer>();
                    this.liveMuxerListeners = new Map<string, MpegListener>();
                    console.log('[DEBUG] All muxers and listeners cleared');
                    return;
                }

                const socketLiveUrl: string = (socket as WebSocketMeta).liveUrl;
                const socketId: string = (socket as WebSocketMeta).id;

                console.log('[DEBUG] Socket close - liveUrl:', socketLiveUrl, 'id:', socketId);

                if (this.liveMuxers.has(socketLiveUrl)) {
                    console.log('[DEBUG] Found muxer for closed socket');
                    const muxer: Mpeg1Muxer | undefined = this.liveMuxers.get(socketLiveUrl);
                    if (!muxer) {
                        console.warn('[DEBUG] Muxer is undefined');
                        return;
                    }

                    const listenerKey = `${socketLiveUrl}-${socketId}`;
                    const listenerFunc: MpegListener | undefined = this.liveMuxerListeners.get(listenerKey);

                    if (listenerFunc) {
                        console.log('[DEBUG] Removing listener:', listenerKey);
                        muxer.removeListener('mpeg1data', listenerFunc);
                        this.liveMuxerListeners.delete(listenerKey);
                    }

                    const remainingListeners = muxer.listenerCount('mpeg1data');
                    console.log('[DEBUG] Remaining listeners for this muxer:', remainingListeners);

                    if (remainingListeners == 0) {
                        console.log('[DEBUG] No more listeners - stopping muxer for:', socketLiveUrl);
                        muxer.stop();
                        this.liveMuxers.delete(socketLiveUrl);
                        console.log('[DEBUG] Muxer deleted, remaining muxers:', this.liveMuxers.size);
                    }
                }
            });

            socket.on('error', (error) => {
                console.error('[DEBUG] WebSocket error:', error);
            });

            socket.on('message', (data) => {
                console.log('[DEBUG] WebSocket message received:', data);
            });
        });

        this.wsServer.on('error', (error) => {
            console.error('[DEBUG] WebSocket Server error:', error);
        });

        this.wsServer.on('close', () => {
            console.log('[DEBUG] WebSocket Server closed');
        });

        console.info('Stream server started!');
        console.log('[DEBUG] WebSocket server listening on port:', this.options?.wsPort || 9999);
    }

    public stop(): void {
        console.log('[DEBUG] stop() - Stopping VideoStream');
        console.log('[DEBUG] Active muxers:', this.liveMuxers.size);
        console.log('[DEBUG] Active listeners:', this.liveMuxerListeners.size);

        this.wsServer?.close();

        if (this.liveMuxers.size > 0) {
            console.log('[DEBUG] Stopping all muxers');
            [...this.liveMuxers.values()].forEach(skt => {
                console.log('[DEBUG] Stopping individual muxer');
                skt.stop();
            });
        }

        console.log('[DEBUG] VideoStream stopped');
    }

}
