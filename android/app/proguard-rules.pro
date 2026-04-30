# Capacitor bridge classes
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep @com.getcapacitor.annotation.PluginMethod class * { *; }

# App plugin classes (must be kept for Capacitor bridge)
-keep class app.fraterna.beta.LocationPlugin { *; }
-keep class app.fraterna.beta.LocationForegroundService { *; }
-keep class app.fraterna.beta.BootReceiver { *; }
-keep class app.fraterna.beta.FraternaMessagingService { *; }
-keep class app.fraterna.beta.NotificationHelper { *; }
-keep class app.fraterna.beta.MainActivity { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Firebase
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Google Play Services Location
-keep class com.google.android.gms.location.** { *; }
-dontwarn com.google.android.gms.location.**

# Preserve line numbers for debugging
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile