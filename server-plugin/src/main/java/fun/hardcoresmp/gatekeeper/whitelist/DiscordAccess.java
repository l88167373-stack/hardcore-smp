package fun.hardcoresmp.gatekeeper.whitelist;

import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

/** Ce dont la whitelist a besoin côté Discord (implémenté par le bot, ou « désactivé » sans token). */
public interface DiscordAccess {

    enum Presence { PRESENT, ABSENT, UNKNOWN }

    /** Le membre est-il sur le serveur Discord ? UNKNOWN si le bot n'est pas prêt. */
    Presence presence(String discordId);

    /** Identifiants de tous les membres, ou vide si la liste n'est pas (encore) fiable. */
    Optional<Set<String>> memberIds();

    CompletableFuture<Void> giveWhitelistedRole(String discordId);

    CompletableFuture<Void> removeWhitelistedRole(String discordId);

    /** Message dans le salon de logs du staff. */
    void log(LogEntry entry);

    record LogEntry(Kind kind, String title, String description) {
        public enum Kind { SUCCESS, INFO, WARNING, DENIED }
    }

    /** Discord non configuré : présence inconnue, rien n'est envoyé. */
    DiscordAccess DISABLED = new DiscordAccess() {
        @Override
        public Presence presence(String discordId) {
            return Presence.UNKNOWN;
        }

        @Override
        public Optional<Set<String>> memberIds() {
            return Optional.empty();
        }

        @Override
        public CompletableFuture<Void> giveWhitelistedRole(String discordId) {
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> removeWhitelistedRole(String discordId) {
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public void log(LogEntry entry) {
            // Rien : pas de bot.
        }
    };
}
