package fun.hardcoresmp.gatekeeper.whitelist;

import java.util.Collection;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;

/** Actions sur le serveur Minecraft (exécutées sur le thread principal par l'implémentation Bukkit). */
public interface ServerAccess {

    CompletableFuture<Void> whitelist(UUID uuid, String name);

    CompletableFuture<Void> unwhitelist(UUID uuid);

    /** Ajoute à la whitelist tous ces joueurs s'ils n'y sont pas déjà (réconciliation). */
    CompletableFuture<Void> whitelistAll(Collection<UUID> uuids);

    CompletableFuture<Void> kickIfOnline(UUID uuid, Component reason);
}
