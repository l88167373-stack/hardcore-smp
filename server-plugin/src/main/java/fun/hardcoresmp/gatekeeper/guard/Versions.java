package fun.hardcoresmp.gatekeeper.guard;

/** Comparaison de versions X.Y.Z (une pré-version « -beta.1 » passe avant la version finale). */
public final class Versions {

    private Versions() {}

    public static int compare(String a, String b) {
        String[] pa = split(a);
        String[] pb = split(b);
        for (int i = 0; i < 3; i++) {
            int diff = Integer.compare(Integer.parseInt(pa[i]), Integer.parseInt(pb[i]));
            if (diff != 0) return diff;
        }
        if (pa[3].equals(pb[3])) return 0;
        if (pa[3].isEmpty()) return 1;
        if (pb[3].isEmpty()) return -1;
        return pa[3].compareTo(pb[3]);
    }

    public static boolean atLeast(String version, String minimum) {
        try {
            return compare(version, minimum) >= 0;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static String[] split(String version) {
        String clean = version.trim().replaceFirst("^v", "");
        String pre = "";
        int dash = clean.indexOf('-');
        if (dash >= 0) {
            pre = clean.substring(dash + 1);
            clean = clean.substring(0, dash);
        }
        String[] parts = clean.split("\\.");
        if (parts.length != 3) throw new IllegalArgumentException("Version invalide : " + version);
        return new String[] {parts[0], parts[1], parts[2], pre};
    }
}
