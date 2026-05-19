export interface KiroEventFrame {
  headers: Record<string, string>;
  payload: Record<string, any> | null;
}

export class KiroEventStreamDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): KiroEventFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const events: KiroEventFrame[] = [];

    while (this.buffer.length >= 16) {
      const totalLength = this.buffer.readUInt32BE(0);
      if (totalLength < 16 || this.buffer.length < totalLength) {
        break;
      }

      const frame = this.buffer.subarray(0, totalLength);
      this.buffer = this.buffer.subarray(totalLength);

      const event = this.parseFrame(frame);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  private parseFrame(frame: Buffer): KiroEventFrame | null {
    try {
      const headersLength = frame.readUInt32BE(4);
      const headers: Record<string, string> = {};
      let offset = 12;
      const headerEnd = 12 + headersLength;

      while (offset < headerEnd && offset < frame.length) {
        const nameLength = frame[offset];
        offset += 1;
        if (offset + nameLength > frame.length) break;

        const name = frame.subarray(offset, offset + nameLength).toString('utf8');
        offset += nameLength;

        const headerType = frame[offset];
        offset += 1;

        if (headerType !== 7) break;

        const valueLength = frame.readUInt16BE(offset);
        offset += 2;
        if (offset + valueLength > frame.length) break;

        headers[name] = frame.subarray(offset, offset + valueLength).toString('utf8');
        offset += valueLength;
      }

      const payloadStart = 12 + headersLength;
      const payloadEnd = frame.length - 4;
      if (payloadEnd <= payloadStart) {
        return { headers, payload: null };
      }

      const payloadText = frame.subarray(payloadStart, payloadEnd).toString('utf8').trim();
      if (!payloadText) {
        return { headers, payload: null };
      }

      return { headers, payload: JSON.parse(payloadText) };
    } catch {
      return null;
    }
  }
}
