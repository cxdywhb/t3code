// @effect-diagnostics-next-line nodeBuiltinImport:off -- fingerprint and rotate synchronously so a reconnect cannot interleave with either operation.
import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** A provider process owns the connections. Only opaque generations cross the wire. */
export class McpAppConnections {
  private readonly servers = new Map<string, { fingerprint: string; id: string }>();

  observe(server: string, identity: ReadonlyArray<unknown>) {
    const fingerprint = NodeCrypto.createHash("sha256").update(encode(identity)).digest("hex");
    const previous = this.servers.get(server);
    if (previous?.fingerprint === fingerprint) return previous.id;
    const id = NodeCrypto.randomUUID();
    this.servers.set(server, { fingerprint, id });
    return id;
  }

  current(server: string) {
    return this.servers.get(server)?.id;
  }

  forget(server: string) {
    this.servers.delete(server);
  }
}
