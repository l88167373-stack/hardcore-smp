package fun.hardcoresmp.gatekeeper.config;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Configuration du plugin, lue depuis config.yml et validée.
 * Les erreurs ne font jamais planter le serveur : elles sont listées dans {@link #problems()}.
 */
public record GatekeeperConfig(
        Discord discord,
        Guard guard,
        PublicConfigSource publicConfig,
        boolean syncVanillaWhitelist,
        String discordInvite,
        String launcherDownload,
        Set<UUID> bypass,
        Map<String, String> messages,
        Map<String, String> discordMessages,
        List<String> problems) {

    /** Politique quand le bot Discord est déconnecté. */
    public enum OfflinePolicy { ALLOW, DENY }

    public record Discord(
            String token,
            String guildId,
            String whitelistChannelId,
            String logsChannelId,
            String whitelistedRoleId,
            String adminRoleId,
            Duration deleteMessagesAfter,
            int minAccountAgeDays,
            Duration reconcileInterval,
            OfflinePolicy offlinePolicy) {

        /** Le bot peut démarrer : token et serveur renseignés. */
        public boolean configured() {
            return !isTodo(token) && isSnowflake(guildId);
        }
    }

    /** Vérification HSMP Guard à la connexion. */
    public record Guard(boolean enabled, Duration timeout, List<byte[]> keys, boolean failClosed) {

        /** La vérification peut tourner : activée et au moins une vraie clé. */
        public boolean active() {
            return enabled && !keys.isEmpty();
        }
    }

    /** D'où lire config/ (launcher.json, rules.json, allowlist.json). */
    public record PublicConfigSource(String url, Duration refreshInterval) {

        public boolean online() {
            return !isTodo(url) && url.startsWith("https://");
        }
    }

    private static final Pattern SNOWFLAKE = Pattern.compile("^\\d{15,22}$");

    public static boolean isTodo(String value) {
        return value == null || value.isBlank() || value.startsWith("TODO_");
    }

    public static boolean isSnowflake(String value) {
        return value != null && SNOWFLAKE.matcher(value).matches();
    }

    public static GatekeeperConfig from(ConfigurationSection root) {
        List<String> problems = new ArrayList<>();
        ConfigurationSection discord = section(root, "discord");

        String token = discord.getString("token", "TODO_DISCORD_BOT_TOKEN");
        String guildId = snowflake(discord, "guild-id", problems);
        String whitelistChannel = snowflake(discord, "channels.whitelist", problems);
        String logsChannel = snowflake(discord, "channels.logs", problems);
        String whitelistedRole = snowflake(discord, "roles.whitelisted", problems);
        String adminRole = snowflake(discord, "roles.admin", problems);
        if (isTodo(token)) problems.add("discord.token : à renseigner (le bot Discord ne démarre pas)");

        int deleteAfter = Math.max(0, discord.getInt("delete-messages-after-seconds", 15));
        int minAge = Math.max(0, discord.getInt("min-account-age-days", 7));
        int reconcileHours = Math.max(1, discord.getInt("reconcile-interval-hours", 6));
        String policyRaw = discord.getString("offline-policy", "allow");
        OfflinePolicy policy = "deny".equalsIgnoreCase(policyRaw) ? OfflinePolicy.DENY : OfflinePolicy.ALLOW;
        if (!"allow".equalsIgnoreCase(policyRaw) && !"deny".equalsIgnoreCase(policyRaw)) {
            problems.add("discord.offline-policy : « " + policyRaw + " » inconnu, « allow » utilisé");
        }

        Set<UUID> bypass = new LinkedHashSet<>();
        for (String raw : root.getStringList("bypass.uuids")) {
            try {
                bypass.add(UUID.fromString(raw.trim()));
            } catch (IllegalArgumentException e) {
                problems.add("bypass.uuids : « " + raw + " » n'est pas un UUID valide (ignoré)");
            }
        }

        List<byte[]> keys = new ArrayList<>();
        for (String raw : root.getStringList("guard.keys")) {
            if (isTodo(raw)) continue;
            try {
                byte[] key = java.util.Base64.getDecoder().decode(raw.trim());
                if (key.length < 32) problems.add("guard.keys : une clé est trop courte (32 octets minimum), ignorée");
                else keys.add(key);
            } catch (IllegalArgumentException e) {
                problems.add("guard.keys : « " + raw + " » n'est pas du base64 valide (ignorée)");
            }
        }
        boolean guardEnabled = root.getBoolean("guard.enabled", true);
        if (guardEnabled && keys.isEmpty()) {
            problems.add("guard.keys : aucune clé renseignée, la vérification HSMP Guard est désactivée");
        }
        Guard guard = new Guard(guardEnabled, Duration.ofSeconds(Math.max(2, root.getInt("guard.timeout-seconds", 5))),
                List.copyOf(keys), root.getBoolean("guard.fail-closed", true));

        String publicUrl = root.getString("public-config.url", "TODO_PUBLIC_CONFIG_URL").trim();
        if (!isTodo(publicUrl) && !publicUrl.endsWith("/")) publicUrl = publicUrl + "/";
        if (!isTodo(publicUrl) && !publicUrl.startsWith("https://")) {
            problems.add("public-config.url : doit commencer par https://");
        }
        PublicConfigSource publicConfig = new PublicConfigSource(publicUrl,
                Duration.ofMinutes(Math.max(1, root.getInt("public-config.refresh-minutes", 10))));

        return new GatekeeperConfig(
                new Discord(token, guildId, whitelistChannel, logsChannel, whitelistedRole, adminRole,
                        Duration.ofSeconds(deleteAfter), minAge, Duration.ofHours(reconcileHours), policy),
                guard,
                publicConfig,
                root.getBoolean("whitelist.sync-vanilla-whitelist", true),
                root.getString("links.discord-invite", "TODO_DISCORD_INVITE"),
                root.getString("links.launcher-download", "TODO_LAUNCHER_DOWNLOAD"),
                Set.copyOf(bypass),
                strings(section(root, "messages")),
                strings(section(root, "discord-messages")),
                List.copyOf(problems));
    }

    /** Message de config (MiniMessage) avec une valeur de secours si la clé manque. */
    public String message(String key) {
        return messages.getOrDefault(key, "<red>" + key + "</red>");
    }

    /** Réponse du bot Discord avec ses variables {nom} remplacées. */
    public String discordMessage(String key, Map<String, String> variables) {
        String text = discordMessages.getOrDefault(key, key);
        for (Map.Entry<String, String> variable : variables.entrySet()) {
            text = text.replace("{" + variable.getKey() + "}", variable.getValue());
        }
        return text;
    }

    private static ConfigurationSection section(ConfigurationSection root, String path) {
        ConfigurationSection section = root.getConfigurationSection(path);
        return section != null ? section : root.createSection(path);
    }

    private static String snowflake(ConfigurationSection section, String path, List<String> problems) {
        String value = section.getString(path, "");
        if (isTodo(value)) {
            problems.add("discord." + path + " : à renseigner");
        } else if (!isSnowflake(value)) {
            problems.add("discord." + path + " : « " + value + " » n'est pas un identifiant Discord valide");
        }
        return value;
    }

    private static Map<String, String> strings(ConfigurationSection section) {
        Map<String, String> result = new java.util.HashMap<>();
        for (String key : section.getKeys(false)) {
            String value = section.getString(key);
            if (value != null) result.put(key, value);
        }
        return Map.copyOf(result);
    }
}
