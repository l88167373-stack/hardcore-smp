package fun.hardcoresmp.gatekeeper.storage;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Liens Discord ↔ Minecraft : en mémoire (lectures instantanées, utilisables depuis n'importe quel thread)
 * et enregistrés dans SQLite (écritures sur le fil de la base).
 */
public final class LinkStore {

    private final Database database;
    private final Map<UUID, Link> byUuid = new ConcurrentHashMap<>();
    private final Map<String, Link> byDiscord = new ConcurrentHashMap<>();

    public LinkStore(Database database) {
        this.database = database;
    }

    /** Charge tous les liens au démarrage. */
    public void load() {
        List<Link> links = database.now(connection -> {
            List<Link> result = new ArrayList<>();
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT uuid, discord_id, name, linked_at, linked_by FROM links");
                 ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    result.add(new Link(
                            UUID.fromString(rows.getString("uuid")),
                            rows.getString("discord_id"),
                            rows.getString("name"),
                            Instant.ofEpochMilli(rows.getLong("linked_at")),
                            rows.getString("linked_by")));
                }
            }
            return result;
        });
        byUuid.clear();
        byDiscord.clear();
        links.forEach(this::cache);
    }

    public Optional<Link> byUuid(UUID uuid) {
        return Optional.ofNullable(byUuid.get(uuid));
    }

    public Optional<Link> byDiscordId(String discordId) {
        return Optional.ofNullable(byDiscord.get(discordId));
    }

    /** Recherche par pseudo (sans tenir compte des majuscules), pour les commandes du staff. */
    public Optional<Link> byName(String name) {
        String wanted = name.toLowerCase(Locale.ROOT);
        return byUuid.values().stream().filter(link -> link.name().toLowerCase(Locale.ROOT).equals(wanted)).findFirst();
    }

    public Collection<Link> all() {
        return List.copyOf(byUuid.values());
    }

    public int size() {
        return byUuid.size();
    }

    /** Ajoute ou remplace le lien de cet UUID. */
    public CompletableFuture<Void> save(Link link) {
        byUuid(link.uuid()).ifPresent(this::uncache);
        byDiscordId(link.discordId()).ifPresent(this::uncache);
        cache(link);
        return database.submit(connection -> {
            try (PreparedStatement delete = connection.prepareStatement("DELETE FROM links WHERE uuid = ? OR discord_id = ?")) {
                delete.setString(1, link.uuid().toString());
                delete.setString(2, link.discordId());
                delete.executeUpdate();
            }
            try (PreparedStatement insert = connection.prepareStatement(
                    "INSERT INTO links (uuid, discord_id, name, linked_at, linked_by) VALUES (?, ?, ?, ?, ?)")) {
                insert.setString(1, link.uuid().toString());
                insert.setString(2, link.discordId());
                insert.setString(3, link.name());
                insert.setLong(4, link.linkedAt().toEpochMilli());
                insert.setString(5, link.linkedBy());
                insert.executeUpdate();
            }
            return null;
        });
    }

    public CompletableFuture<Void> delete(UUID uuid) {
        byUuid(uuid).ifPresent(this::uncache);
        return database.submit(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("DELETE FROM links WHERE uuid = ?")) {
                statement.setString(1, uuid.toString());
                statement.executeUpdate();
            }
            return null;
        });
    }

    /** Met à jour le pseudo enregistré (le joueur a changé de pseudo). */
    public CompletableFuture<Void> rename(UUID uuid, String name) {
        Link current = byUuid.get(uuid);
        if (current == null || current.name().equals(name)) return CompletableFuture.completedFuture(null);
        return save(new Link(uuid, current.discordId(), name, current.linkedAt(), current.linkedBy()));
    }

    /** Historique (audit) : qui a fait quoi, quand. */
    public CompletableFuture<Void> audit(String type, UUID uuid, String discordId, String detail) {
        return database.submit(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO audit_log (at, type, uuid, discord_id, detail) VALUES (?, ?, ?, ?, ?)")) {
                statement.setLong(1, System.currentTimeMillis());
                statement.setString(2, type);
                statement.setString(3, uuid == null ? null : uuid.toString());
                statement.setString(4, discordId);
                statement.setString(5, detail);
                statement.executeUpdate();
            }
            return null;
        });
    }

    private void cache(Link link) {
        byUuid.put(link.uuid(), link);
        byDiscord.put(link.discordId(), link);
    }

    private void uncache(Link link) {
        byUuid.remove(link.uuid(), link);
        byDiscord.remove(link.discordId(), link);
    }
}
