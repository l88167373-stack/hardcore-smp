package fun.hardcoresmp.guard;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * Messages échangés avec le serveur sur le canal « hsmp:guard », pendant la phase de configuration
 * (avant d'entrer dans le monde). Format binaire brut, identique côté plugin Paper.
 */
final class GuardPayloads {

    static final Identifier CHANNEL = Identifier.fromNamespaceAndPath("hsmp", "guard");
    static final int NONCE_LENGTH = 32;

    private GuardPayloads() {}

    /** Défi du serveur : version du protocole, nonce aléatoire (anti-rejeu), heure d'émission. */
    record Challenge(byte protocol, byte[] nonce, long issuedAt) implements CustomPacketPayload {
        static final Type<Challenge> TYPE = new Type<>(CHANNEL);
        static final StreamCodec<FriendlyByteBuf, Challenge> CODEC = CustomPacketPayload.codec(Challenge::write, Challenge::read);

        private static Challenge read(FriendlyByteBuf buf) {
            byte protocol = buf.readByte();
            byte[] nonce = new byte[NONCE_LENGTH];
            buf.readBytes(nonce);
            return new Challenge(protocol, nonce, buf.readLong());
        }

        private void write(FriendlyByteBuf buf) {
            buf.writeByte(protocol);
            buf.writeBytes(nonce);
            buf.writeLong(issuedAt);
        }

        @Override
        public Type<Challenge> type() {
            return TYPE;
        }
    }

    /** Réponse du client : JSON signé puis compressé (gzip), envoyé tel quel. */
    record Response(byte[] data) implements CustomPacketPayload {
        static final Type<Response> TYPE = new Type<>(CHANNEL);
        static final StreamCodec<FriendlyByteBuf, Response> CODEC = CustomPacketPayload.codec(Response::write, Response::read);

        private static Response read(FriendlyByteBuf buf) {
            byte[] data = new byte[buf.readableBytes()];
            buf.readBytes(data);
            return new Response(data);
        }

        private void write(FriendlyByteBuf buf) {
            buf.writeBytes(data);
        }

        @Override
        public Type<Response> type() {
            return TYPE;
        }
    }
}
