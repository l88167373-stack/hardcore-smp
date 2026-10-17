# Règles ProGuard du HSMP Guard : on garde seulement ce que Fabric doit trouver par son nom.

# Point d'entrée déclaré dans fabric.mod.json.
-keep class fun.hardcoresmp.guard.GuardClient {
    public <init>();
    public void onInitializeClient();
}

# Messages réseau (records) : structure conservée, noms internes obfusqués ailleurs.
-keep class fun.hardcoresmp.guard.GuardPayloads$* { *; }

-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,Record,PermittedSubclasses,NestHost,NestMembers

# Tout le reste (dont la clé) est renommé et regroupé.
-repackageclasses fun.hardcoresmp.guard.z
-allowaccessmodification
-dontoptimize
-dontshrink
-dontwarn **
-dontnote **
-ignorewarnings
