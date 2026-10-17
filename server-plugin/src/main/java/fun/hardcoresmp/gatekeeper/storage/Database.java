package fun.hardcoresmp.gatekeeper.storage;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Base SQLite (fichier gatekeeper.db du dossier du plugin).
 * Toutes les requêtes passent par un fil d'exécution dédié : jamais sur le thread principal du serveur.
 */
public final class Database implements AutoCloseable {

    @FunctionalInterface
    public interface SqlWork<T> {
        T run(Connection connection) throws SQLException;
    }

    /** Version du schéma : à augmenter avec une nouvelle migration dans {@link #migrate()}. */
    static final int SCHEMA_VERSION = 2;

    private final Connection connection;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "HSMPGatekeeper-SQLite");
        thread.setDaemon(true);
        return thread;
    });

    public Database(Path file) throws SQLException {
        try {
            Files.createDirectories(file.toAbsolutePath().getParent());
        } catch (java.io.IOException e) {
            throw new SQLException("Impossible de créer le dossier de la base : " + e.getMessage(), e);
        }
        this.connection = DriverManager.getConnection("jdbc:sqlite:" + file.toAbsolutePath());
        try (Statement statement = connection.createStatement()) {
            statement.execute("PRAGMA journal_mode=WAL");
            statement.execute("PRAGMA foreign_keys=ON");
            statement.execute("PRAGMA busy_timeout=5000");
        }
        migrate();
    }

    public <T> CompletableFuture<T> submit(SqlWork<T> work) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return work.run(connection);
            } catch (SQLException e) {
                throw new StorageException(e);
            }
        }, executor);
    }

    /** Exécution immédiate et bloquante (démarrage du plugin uniquement). */
    public <T> T now(SqlWork<T> work) {
        return submit(work).join();
    }

    private void migrate() throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
            int current = 0;
            try (var result = statement.executeQuery("SELECT MAX(version) FROM schema_version")) {
                if (result.next()) current = result.getInt(1);
            }
            if (current < 1) {
                // Lien compte Discord ↔ compte Minecraft (un pour un).
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS links (
                          uuid TEXT PRIMARY KEY,
                          discord_id TEXT NOT NULL UNIQUE,
                          name TEXT NOT NULL,
                          linked_at INTEGER NOT NULL,
                          linked_by TEXT NOT NULL
                        )""");
                // Preuve d'acceptation du règlement (utilisée par la vérification à la connexion, phase 5).
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS rules_acceptance (
                          uuid TEXT NOT NULL,
                          version INTEGER NOT NULL,
                          accepted_at INTEGER NOT NULL,
                          PRIMARY KEY (uuid, version)
                        )""");
                // Historique de tout ce qui touche la whitelist (qui, quoi, quand).
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS audit_log (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          at INTEGER NOT NULL,
                          type TEXT NOT NULL,
                          uuid TEXT,
                          discord_id TEXT,
                          detail TEXT
                        )""");
                statement.execute("INSERT INTO schema_version (version) VALUES (1)");
            }
            if (current < 2) {
                // Fichiers identifiés sur Modrinth (empreinte SHA-512 → projet), pour ne pas redemander à chaque connexion.
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS modrinth_cache (
                          sha512 TEXT PRIMARY KEY,
                          project_id TEXT NOT NULL,
                          dependencies TEXT NOT NULL,
                          checked_at INTEGER NOT NULL
                        )""");
                statement.execute("INSERT INTO schema_version (version) VALUES (2)");
            }
        }
    }

    @Override
    public void close() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(5, TimeUnit.SECONDS)) executor.shutdownNow();
            connection.close();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (SQLException ignored) {
            // Fermeture : rien de plus à faire.
        }
    }

    /** Erreur SQL remontée depuis le fil de la base. */
    public static final class StorageException extends RuntimeException {
        public StorageException(SQLException cause) {
            super(cause.getMessage(), cause);
        }
    }
}
