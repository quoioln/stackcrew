package {{sc:basePackage}}.common.logging;

import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.Writer;
import java.nio.charset.Charset;

/**
 * Write-through response wrapper for HttpLoggingFilter. Every byte and every header goes straight to the client, so
 * Content-Length, Content-Disposition, flushes and streams behave exactly as without logging; nothing is held back
 * and no size is limited to an int. A body the masker can parse (JSON, *+json, form) of a non-streaming request is
 * also copied, up to captureLimit bytes, into a side buffer for the log line. Everything else is only counted.
 * The choice is made at the first write, when the content type is set and the request is known to be async or not.
 */
public class TeeResponseWrapper extends HttpServletResponseWrapper {

    private final HttpServletRequest request;
    private final int captureLimit;
    private final ByteArrayOutputStream captured = new ByteArrayOutputStream();
    private Boolean capturing;
    private boolean overflowed;
    private long bytesWritten;
    private ServletOutputStream outputStream;
    private PrintWriter writer;

    public TeeResponseWrapper(HttpServletResponse response, HttpServletRequest request, int captureLimit) {
        super(response);
        this.request = request;
        this.captureLimit = captureLimit;
    }

    /** The whole body when it was captured and fit under the limit; otherwise null (log a size placeholder). */
    public synchronized byte[] capturedBody() {
        return Boolean.TRUE.equals(capturing) && !overflowed ? captured.toByteArray() : null;
    }

    public synchronized long bytesWritten() {
        return bytesWritten;
    }

    @Override
    public ServletOutputStream getOutputStream() throws IOException {
        if (outputStream == null) {
            outputStream = new TeeOutputStream(super.getOutputStream());
        }
        return outputStream;
    }

    @Override
    public PrintWriter getWriter() throws IOException {
        if (writer == null) {
            PrintWriter raw = super.getWriter();
            Charset charset = Charset.forName(getCharacterEncoding());
            writer = new PrintWriter(new Writer() {
                @Override
                public void write(char[] chars, int offset, int length) {
                    raw.write(chars, offset, length);
                    byte[] bytes = new String(chars, offset, length).getBytes(charset);
                    record(bytes, 0, bytes.length);
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
        return writer;
    }

    @Override
    public synchronized void resetBuffer() {
        super.resetBuffer();
        captured.reset();
        bytesWritten = 0;
        overflowed = false;
    }

    @Override
    public synchronized void reset() {
        super.reset();
        captured.reset();
        bytesWritten = 0;
        overflowed = false;
        capturing = null;
    }

    private synchronized void record(byte[] bytes, int offset, int length) {
        bytesWritten += length;
        if (capturing == null) {
            capturing = !request.isAsyncStarted() && BodyMasker.isMaskable(getContentType());
        }
        if (capturing && !overflowed) {
            if ((long) captured.size() + length > captureLimit) {
                overflowed = true;
                captured.reset();
            } else {
                captured.write(bytes, offset, length);
            }
        }
    }

    private final class TeeOutputStream extends ServletOutputStream {
        private final ServletOutputStream delegate;

        TeeOutputStream(ServletOutputStream delegate) {
            this.delegate = delegate;
        }

        @Override
        public void write(int b) throws IOException {
            delegate.write(b);
            record(new byte[] {(byte) b}, 0, 1);
        }

        @Override
        public void write(byte[] bytes, int offset, int length) throws IOException {
            delegate.write(bytes, offset, length);
            record(bytes, offset, length);
        }

        @Override
        public void flush() throws IOException {
            delegate.flush();
        }

        @Override
        public void close() throws IOException {
            delegate.close();
        }

        @Override
        public boolean isReady() {
            return delegate.isReady();
        }

        @Override
        public void setWriteListener(WriteListener listener) {
            delegate.setWriteListener(listener);
        }
    }
}
