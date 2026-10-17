package fun.hardcoresmp.gatekeeper.whitelist;

import fun.hardcoresmp.gatekeeper.config.GatekeeperConfig;
import fun.hardcoresmp.gatekeeper.config.Texts;
import fun.hardcoresmp.gatekeeper.mojang.ProfileLookup;
import fun.hardcoresmp.gatekeeper.storage.Link;
import fun.hardcoresmp.gatekeeper.storage.LinkStore;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess.LogEntry;
import fun.hardcoresmp.gatekeeper.whitelist.DiscordAccess.LogEntry.Kind;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Cœur de la whitelist : lier un compte Discord à un compte Minecraft, le retirer,
 * réconcilier avec la liste des membres du Discord et décider qui peut se connecter.
 * Indépendant de Discord et de Bukkit (testable avec de faux services).
 */
public final class WhitelistService {

    /** Pseudo Minecraft valide : 3 à 16 caractères, lettres, chiffres et « _ ». */
    public static final Pattern NAME = Pattern.compile("^[A-Za-z0-9_]{3,16}$");

    /** En dessous de ce nombre de liens, la protection anti « retrait massif » ne s'applique pas. */
    static final int MASS_REMOVAL_MIN_LINKS = 5;

    public sealed interface LinkOutcome {
        record Linked(Link link) implements LinkOutcome {}
        record AlreadyLinkedSame(Link link) implements LinkOutcome {}
        record InvalidName() implements LinkOutcome {}
        record AccountTooYoung(int minDays) implements LinkOutcome {}
        record AlreadyLinked(Link existing) implements LinkOutcome {}
        record NameNotFound(String name) implements LinkOutcome {}
        record TakenByOther(Link existing) implements LinkOutcome {}
        record LookupFailed() implements LinkOutcome {}
    }

    public enum UnlinkReason {
        LEFT_DISCORD("a quitté le Discord", "kicked-left-discord", false),
        BANNED_DISCORD("a été banni du Discord", "kicked-left-discord", false),
        RECONCILED("n'est plus sur le Discord (vérification automatique)", "kicked-left-discord", false),
        STAFF_REMOVED("retiré par le staff", "kicked-unlinked", true),
        REPLACED("remplacé par un autre lien (/wl force)", "kicked-unlinked", true);

        final String label;
        final String kickMessageKey;
        /** Le membre est encore sur le Discord : on lui retire le rôle « Whitelisté ». */
        final boolean memberStillPresent;

        UnlinkReason(String label, String kickMessageKey, boolean memberStillPresent) {
            this.label = label;
            this.kickMessageKey = kickMessageKey;
            this.memberStillPresent = memberStillPresent;
        }
    }

    public enum LoginDecision { ALLOW, ALLOW_BYPASS, DENY_NOT_WHITELISTED, DENY_LEFT_DISCORD, DENY_DISCORD_OFFLINE }

    private final LinkStore links;
    private final ProfileLookup mojang;
    private final ServerAccess server;
    private final Supplier<DiscordAccess> discord;
    private final Supplier<GatekeeperConfig> config;
    private final Texts texts;
    private final Clock clock;
    private final Logger log;
    private final Object lock = new Object();

    public WhitelistService(LinkStore links, ProfileLookup mojang, ServerAccess server, Supplier<DiscordAccess> discord,
                            Supplier<GatekeeperConfig> config, Texts texts, Clock clock, Logger log) {
        this.links = links;
        this.mojang = mojang;
        this.server = server;
        this.discord = discord;
        this.config = config;
        this.texts = texts;
        this.clock = clock;
        this.log = log;
    }

    /** Un joueur écrit son pseudo dans #whitelist (ou utilise /whitelist). */
    public CompletableFuture<LinkOutcome> requestLink(String discordId, Instant discordAccountCreated, String rawName) {
        String name = rawName.trim();
        if (!NAME.matcher(name).matches()) return done(new LinkOutcome.InvalidName());

        int minDays = config.get().discord().minAccountAgeDays();
        if (minDays > 0 && Duration.between(discordAccountCreated, clock.instant()).toDays() < minDays) {
            return done(new LinkOutcome.AccountTooYoung(minDays));
        }

        Optional<Link> mine = links.byDiscordId(discordId);
        if (mine.isPresent()) {
            Link link = mine.get();
            if (!link.name().equalsIgnoreCase(name)) return done(new LinkOutcome.AlreadyLinked(link));
            // Même compte : on réapplique la whitelist et le rôle (au cas où ils auraient été retirés à la main).
            return applyLinkEffects(link).thenApply(ignored -> new LinkOutcome.AlreadyLinkedSame(link));
        }

        return mojang.byName(name).handle((profile, error) -> {
            if (error != null) {
                log.log(Level.WARNING, "Recherche Mojang impossible pour " + name, error);
                return CompletableFuture.<LinkOutcome>completedFuture(new LinkOutcome.LookupFailed());
            }
            if (profile.isEmpty()) return CompletableFuture.<LinkOutcome>completedFuture(new LinkOutcome.NameNotFound(name));
            ProfileLookup.Profile found = profile.get();
            Link link;
            synchronized (lock) {
                Optional<Link> taken = links.byUuid(found.uuid());
                if (taken.isPresent() && !taken.get().discordId().equals(discordId)) {
                    return CompletableFuture.<LinkOutcome>completedFuture(new LinkOutcome.TakenByOther(taken.get()));
                }
                if (links.byDiscordId(discordId).isPresent()) {
                    // Deux messages envoyés en même temps : le premier a gagné.
                    return CompletableFuture.<LinkOutcome>completedFuture(new LinkOutcome.AlreadyLinked(links.byDiscordId(discordId).get()));
                }
                link = new Link(found.uuid(), discordId, found.name(), clock.instant(), Link.SELF);
                links.save(link);
            }
            return finishLink(link, "s'est whitelisté");
        }).thenCompose(future -> future);
    }

    /** Le staff force un lien (/wl force) : pas de vérification d'âge, les anciens liens sont remplacés. */
    public CompletableFuture<LinkOutcome> forceLink(String discordId, String rawName, String staffId) {
        String name = rawName.trim();
        if (!NAME.matcher(name).matches()) return done(new LinkOutcome.InvalidName());
        return mojang.byName(name).handle((profile, error) -> {
            if (error != null) return CompletableFuture.<LinkOutcome>completedFuture(new LinkOutcome.LookupFailed());
            if (profile.isEmpty()) return CompletableFuture.<LinkOutcome>completedFuture(new LinkOutcome.NameNotFound(name));
            ProfileLookup.Profile found = profile.get();
            CompletableFuture<?> cleanup = CompletableFuture.completedFuture(null);
            Link link;
            synchronized (lock) {
                Optional<Link> oldForMember = links.byDiscordId(discordId).filter(l -> !l.uuid().equals(found.uuid()));
                Optional<Link> oldForAccount = links.byUuid(found.uuid()).filter(l -> !l.discordId().equals(discordId));
                if (oldForMember.isPresent()) cleanup = unlink(oldForMember.get().uuid(), UnlinkReason.REPLACED, staffId);
                if (oldForAccount.isPresent()) {
                    // Le compte Minecraft change de propriétaire Discord : l'ancien perd seulement son rôle.
                    String previousOwner = oldForAccount.get().discordId();
                    cleanup = cleanup.thenCompose(ignored -> discord.get().removeWhitelistedRole(previousOwner));
                }
                link = new Link(found.uuid(), discordId, found.name(), clock.instant(), staffId);
                links.save(link);
            }
            return cleanup.thenCompose(ignored -> finishLink(link, "a été whitelisté par le staff (<@" + staffId + ">)"));
        }).thenCompose(future -> future);
    }

    public CompletableFuture<Optional<Link>> unlink(UUID uuid, UnlinkReason reason, String actor) {
        Optional<Link> removed;
        synchronized (lock) {
            removed = links.byUuid(uuid);
            if (removed.isEmpty()) return CompletableFuture.completedFuture(Optional.empty());
            links.delete(uuid);
        }
        Link link = removed.get();
        GatekeeperConfig current = config.get();
        CompletableFuture<Void> effects = server.kickIfOnline(uuid, texts.render(reason.kickMessageKey, link.name()));
        if (current.syncVanillaWhitelist()) effects = effects.thenCompose(ignored -> server.unwhitelist(uuid));
        if (reason.memberStillPresent) effects = effects.thenCompose(ignored -> discord.get().removeWhitelistedRole(link.discordId()));
        links.audit("UNLINK", uuid, link.discordId(), reason.name() + " par " + actor);
        log.info(link.name() + " retiré de la whitelist : " + reason.label);
        discord.get().log(new LogEntry(Kind.WARNING, "Retiré de la whitelist : " + link.name(),
                "<@" + link.discordId() + "> " + reason.label + ".\nUUID : `" + uuid + "`"));
        return effects.handle((ignored, error) -> {
            if (error != null) log.log(Level.WARNING, "Retrait de " + link.name() + " : effet partiel", error);
            return removed;
        });
    }

    public CompletableFuture<Optional<Link>> unlinkDiscord(String discordId, UnlinkReason reason, String actor) {
        return links.byDiscordId(discordId)
                .map(link -> unlink(link.uuid(), reason, actor))
                .orElseGet(() -> CompletableFuture.completedFuture(Optional.empty()));
    }

    /**
     * Retire les joueurs dont le compte Discord n'est plus sur le serveur (départs manqués pendant que
     * le serveur Minecraft était éteint) et remet à jour la whitelist. Renvoie le nombre de joueurs retirés.
     */
    public CompletableFuture<Integer> reconcile() {
        Optional<Set<String>> members = discord.get().memberIds();
        if (members.isEmpty()) {
            log.info("Réconciliation reportée : liste des membres Discord indisponible");
            return CompletableFuture.completedFuture(0);
        }
        Set<String> present = members.get();
        List<Link> all = List.copyOf(links.all());
        List<Link> gone = all.stream().filter(link -> !present.contains(link.discordId())).toList();
        if (all.size() >= MASS_REMOVAL_MIN_LINKS && gone.size() * 2 > all.size()) {
            String message = "Réconciliation annulée : " + gone.size() + " joueurs sur " + all.size()
                    + " seraient retirés. C'est anormal (intention « Server Members » désactivée ? mauvais serveur Discord ?).";
            log.warning(message);
            discord.get().log(new LogEntry(Kind.WARNING, "Réconciliation annulée par sécurité", message));
            return CompletableFuture.completedFuture(0);
        }
        CompletableFuture<?> chain = CompletableFuture.completedFuture(null);
        for (Link link : gone) chain = chain.thenCompose(ignored -> unlink(link.uuid(), UnlinkReason.RECONCILED, "réconciliation"));
        if (config.get().syncVanillaWhitelist()) {
            List<UUID> keep = all.stream().filter(link -> present.contains(link.discordId())).map(Link::uuid).toList();
            chain = chain.thenCompose(ignored -> server.whitelistAll(keep));
        }
        return chain.thenApply(ignored -> {
            if (!gone.isEmpty()) log.info("Réconciliation : " + gone.size() + " joueur(s) retiré(s)");
            return gone.size();
        });
    }

    /** Décision à la connexion (instantanée : tout est en mémoire). */
    public LoginDecision loginDecision(UUID uuid) {
        GatekeeperConfig current = config.get();
        if (current.bypass().contains(uuid)) return LoginDecision.ALLOW_BYPASS;
        Optional<Link> link = links.byUuid(uuid);
        if (link.isEmpty()) return LoginDecision.DENY_NOT_WHITELISTED;
        return switch (discord.get().presence(link.get().discordId())) {
            case PRESENT -> LoginDecision.ALLOW;
            case ABSENT -> {
                // Parti du Discord pendant que le serveur était éteint : on le retire tout de suite.
                unlink(uuid, UnlinkReason.LEFT_DISCORD, "connexion");
                yield LoginDecision.DENY_LEFT_DISCORD;
            }
            case UNKNOWN -> current.discord().offlinePolicy() == GatekeeperConfig.OfflinePolicy.DENY
                    ? LoginDecision.DENY_DISCORD_OFFLINE
                    : LoginDecision.ALLOW;
        };
    }

    public Optional<Link> linkOf(UUID uuid) {
        return links.byUuid(uuid);
    }

    public Optional<Link> linkOfDiscord(String discordId) {
        return links.byDiscordId(discordId);
    }

    public Optional<Link> linkOfName(String name) {
        return links.byName(name);
    }

    public List<Link> allLinks() {
        return List.copyOf(links.all());
    }

    /** Le joueur a changé de pseudo : on met à jour le nom enregistré (l'UUID, lui, ne change pas). */
    public CompletableFuture<Void> rename(UUID uuid, String name) {
        return links.rename(uuid, name);
    }

    private CompletableFuture<LinkOutcome> finishLink(Link link, String action) {
        links.audit("LINK", link.uuid(), link.discordId(), link.linkedBy());
        log.info(link.name() + " (" + link.uuid() + ") " + action);
        discord.get().log(new LogEntry(Kind.SUCCESS, "Whitelisté : " + link.name(),
                "<@" + link.discordId() + "> " + action + ".\nUUID : `" + link.uuid() + "`"));
        return applyLinkEffects(link).thenApply(ignored -> new LinkOutcome.Linked(link));
    }

    private CompletableFuture<Void> applyLinkEffects(Link link) {
        CompletableFuture<Void> whitelist = config.get().syncVanillaWhitelist()
                ? server.whitelist(link.uuid(), link.name())
                : CompletableFuture.completedFuture(null);
        return whitelist
                .thenCompose(ignored -> discord.get().giveWhitelistedRole(link.discordId()))
                .exceptionally(error -> {
                    log.log(Level.WARNING, "Whitelist de " + link.name() + " : effet partiel (rôle ou whitelist)", error);
                    return null;
                });
    }

    private static CompletableFuture<LinkOutcome> done(LinkOutcome outcome) {
        return CompletableFuture.completedFuture(outcome);
    }
}
