package fun.hardcoresmp.gatekeeper.storage;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Preuve d'acceptation du règlement : UUID, version, date (enregistrée à la première connexion acceptée). */
public final class RulesAcceptanceStore {

    private final Database database;

    public RulesAcceptanceStore(Database database) {
        this.database = database;
    }

    /** Enregistre l'acceptation (sans écraser la date d'une acceptation déjà connue). */
    public CompletableFuture<Void> record(UUID uuid, int version, Instant at) {
        return database.submit(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT OR IGNORE INTO rules_acceptance (uuid, version, accepted_at) VALUES (?, ?, ?)")) {
                statement.setString(1, uuid.toString());
                statement.setInt(2, version);
                statement.setLong(3, at.toEpochMilli());
                statement.executeUpdate();
            }
            return null;
        });
    }

    /** Date à laquelle ce joueur a accepté cette version, si c'est le cas. */
    public CompletableFuture<Optional<Instant>> acceptedAt(UUID uuid, int version) {
        return database.submit(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT accepted_at FROM rules_acceptance WHERE uuid = ? AND version = ?")) {
                statement.setString(1, uuid.toString());
                statement.setInt(2, version);
                try (ResultSet row = statement.executeQuery()) {
                    return row.next() ? Optional.of(Instant.ofEpochMilli(row.getLong(1))) : Optional.empty();
                }
            }
        });
    }
}
