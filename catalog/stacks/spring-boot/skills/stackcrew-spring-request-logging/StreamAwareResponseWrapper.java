package {{sc:basePackage}}.common.logging;

import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.util.ContentCachingResponseWrapper;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.Charset;

/**
 * Caches the response body like its parent, so HttpLoggingFilter can mask it, except for streams and downloads:
 * SSE, StreamingResponseBody and other bodies written while the request is async, application/octet-stream and
 * Content-Disposition: attachment. Those pass straight through to the client (flushes included) and are only counted.
 * The decision is made at the first write, not when the stream is fetched: Spring fetches the stream of a
 * StreamingResponseBody before the request goes async and writes to it later, from another thread.
 */
public class StreamAwareResponseWrapper extends ContentCachingResponseWrapper {

    private static final String ATTACHMENT = "attachment";

    private final HttpServletRequest request;
    private final ServletOutputStream decidingStream = new DecidingOutputStream();
    private volatile Boolean streaming;
    private volatile long streamedBytes;
    private ServletOutputStream passThrough;

    public StreamAwareResponseWrapper(HttpServletResponse response, HttpServletRequest request) {
        super(response);
        this.request = request;
    }

    /** True when the body went to the client unbuffered; then only streamedBytes() is known. */
    public boolean isStreamed() {
        return Boolean.TRUE.equals(streaming);
    }

    public long streamedBytes() {
        return streamedBytes;
    }

    @Override
    public ServletOutputStream getOutputStream() {
        return decidingStream;
    }

    @Override
    public PrintWriter getWriter() throws IOException {
        if (!decideStreaming()) {
            return super.getWriter();
        }
        PrintWriter raw = getResponse().getWriter();
        Charset charset = Charset.forName(getCharacterEncoding());
        return new PrintWriter(new Writer() {
            @Override
            public void write(char[] chars, int offset, int length) {
                raw.write(chars, offset, length);
                streamedBytes += new String(chars, offset, length).getBytes(charset).length;
            }

            @Override
            public void flush() {
                raw.flush();
            }

            @Override
            public void close() {
                raw.close();
            }
        });
    }

    /** The parent swallows flushBuffer until the body is copied; a stream must reach the client as it is written. */
    @Override
    public void flushBuffer() throws IOException {
        if (isStreamed()) {
            getResponse().flushBuffer();
        } else {
            super.flushBuffer();
        }
    }

    private boolean decideStreaming() {
        if (streaming == null) {
            String type = getContentType();
            String disposition = getHeader(HttpHeaders.CONTENT_DISPOSITION);
            streaming = request.isAsyncStarted()
                    || (type != null && (type.startsWith(MediaType.TEXT_EVENT_STREAM_VALUE)
                            || type.startsWith(MediaType.APPLICATION_OCTET_STREAM_VALUE)))
                    || (disposition != null && disposition.startsWith(ATTACHMENT));
        }
        return streaming;
    }

    private ServletOutputStream target() throws IOException {
        if (!decideStreaming()) {
            return super.getOutputStream();
        }
        if (passThrough == null) {
            passThrough = getResponse().getOutputStream();
        }
        return passThrough;
    }

    /** Fetching the stream decides nothing; the first write does. Bytes written to the client are counted. */
    private final class DecidingOutputStream extends ServletOutputStream {

        @Override
        public void write(int b) throws IOException {
            target().write(b);
            if (isStreamed()) {
                streamedBytes++;
            }
        }

        @Override
        public void write(byte[] bytes, int offset, int length) throws IOException {
            target().write(bytes, offset, length);
            if (isStreamed()) {
                streamedBytes += length;
            }
        }

        @Override
        public void flush() throws IOException {
            if (streaming != null) {
                target().flush();
            }
        }

        @Override
        public void close() throws IOException {
            if (streaming != null) {
                target().close();
            }
        }

        @Override
        public boolean isReady() {
            return raw().isReady();
        }

        @Override
        public void setWriteListener(WriteListener listener) {
            raw().setWriteListener(listener);
        }

        private ServletOutputStream raw() {
            try {
                return getResponse().getOutputStream();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
    }
}
