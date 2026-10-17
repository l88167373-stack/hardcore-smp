package fun.hardcoresmp.gatekeeper.whitelist;

import java.util.Collection;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * Whitelist et expulsions exécutées sur le thread principal du serveur, comme l'exige l'API Bukkit.
 * Appelable depuis n'importe quel thread (bot Discord, base de données…).
 */
public final class BukkitServerAccess implements ServerAccess {

    private final Plugin plugin;

    public BukkitServerAccess(Plugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public CompletableFuture<Void> whitelist(UUID uuid, String name) {
        return onMainThread(() -> {
            OfflinePlayer player = Bukkit.getOfflinePlayer(uuid);
            if (!player.isWhitelisted()) player.setWhitelisted(true);
        });
    }

    @Override
    public CompletableFuture<Void> unwhitelist(UUID uuid) {
        return onMainThread(() -> {
            OfflinePlayer player = Bukkit.getOfflinePlayer(uuid);
            if (player.isWhitelisted()) player.setWhitelisted(false);
        });
    }

    @Override
    public CompletableFuture<Void> whitelistAll(Collection<UUID> uuids) {
        return onMainThread(() -> {
            for (UUID uuid : uuids) {
                OfflinePlayer player = Bukkit.getOfflinePlayer(uuid);
                if (!player.isWhitelisted()) player.setWhitelisted(true);
            }
        });
    }

    @Override
    public CompletableFuture<Void> kickIfOnline(UUID uuid, Component reason) {
        return onMainThread(() -> {
            Player player = Bukkit.getPlayer(uuid);
            if (player != null) player.kick(reason);
        });
    }

    private CompletableFuture<Void> onMainThread(Runnable action) {
        CompletableFuture<Void> future = new CompletableFuture<>();
        Runnable task = () -> {
            try {
                action.run();
                future.complete(null);
            } catch (RuntimeException e) {
                future.completeExceptionally(e);
            }
        };
        if (Bukkit.isPrimaryThread()) {
            task.run();
        } else if (plugin.isEnabled()) {
            Bukkit.getScheduler().runTask(plugin, task);
        } else {
            future.complete(null);
        }
        return future;
    }
}
