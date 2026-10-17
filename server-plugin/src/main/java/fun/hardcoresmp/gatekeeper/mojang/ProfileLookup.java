package fun.hardcoresmp.gatekeeper.mojang;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Recherche d'un compte Minecraft Java (premium) par pseudo. */
public interface ProfileLookup {

    record Profile(UUID uuid, String name) {}

    /**
     * @return le profil, vide si le pseudo n'existe pas ;
     *         échoue avec {@link LookupException} si les serveurs de Mojang sont injoignables
     */
    CompletableFuture<Optional<Profile>> byName(String name);

    final class LookupException extends RuntimeException {
        public LookupException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
