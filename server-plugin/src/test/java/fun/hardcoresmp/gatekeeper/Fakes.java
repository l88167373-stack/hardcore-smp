package fun.hardcoresmp.gatekeeper;

import fun.hardcoresmp.gatekeeper.mojang.ProfileLookup;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess;
import fun.hardcoresmp.gatekeeper.whitelist.ServerAccess;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;

/** Faux Mojang, faux serveur et faux Discord pour tester la whitelist sans réseau. */
public final class Fakes {

    private Fakes() {}

    public static final class Mojang implements ProfileLookup {
        public final Map<String, Profile> profiles = new HashMap<>();
        public boolean down = false;

        public Mojang add(String name, UUID uuid) {
            profiles.put(name.toLowerCase(java.util.Locale.ROOT), new Profile(uuid, name));
            return this;
        }

        @Override
        public CompletableFuture<Optional<Profile>> byName(String name) {
            if (down) return CompletableFuture.failedFuture(new LookupException("panne simulée", null));
            return CompletableFuture.completedFuture(Optional.ofNullable(profiles.get(name.toLowerCase(java.util.Locale.ROOT))));
        }
    }

    public static final class Server implements ServerAccess {
        public final Set<UUID> whitelisted = new HashSet<>();
        public final List<UUID> kicked = new ArrayList<>();

        @Override
        public CompletableFuture<Void> whitelist(UUID uuid, String name) {
            whitelisted.add(uuid);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> unwhitelist(UUID uuid) {
            whitelisted.remove(uuid);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> whitelistAll(Collection<UUID> uuids) {
            whitelisted.addAll(uuids);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> kickIfOnline(UUID uuid, Component reason) {
            kicked.add(uuid);
            return CompletableFuture.completedFuture(null);
        }
    }

    public static final class Discord implements DiscordAccess {
        /** null = bot pas prêt (présence inconnue). */
        public Set<String> members = new HashSet<>();
        public final Set<String> withRole = new HashSet<>();
        public final List<LogEntry> logs = new ArrayList<>();

        @Override
        public Presence presence(String discordId) {
            if (members == null) return Presence.UNKNOWN;
            return members.contains(discordId) ? Presence.PRESENT : Presence.ABSENT;
        }

        @Override
        public Optional<Set<String>> memberIds() {
            return Optional.ofNullable(members).map(Set::copyOf);
        }

        @Override
        public CompletableFuture<Void> giveWhitelistedRole(String discordId) {
            withRole.add(discordId);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> removeWhitelistedRole(String discordId) {
            withRole.remove(discordId);
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public void log(LogEntry entry) {
            logs.add(entry);
        }
    }
}
