# Easy Party Kit — Android home-screen widget (first implementation)

This is a **private Android companion app**, not a second database. The app opens
the existing Easy Party Kit website. The React app builds a snapshot of bookings
and payments and sends it to the Android host via the write-only `EasyPartyWidget`
JavaScript interface. The home-screen widget reads the last snapshot stored
privately on the device.

## Dashboard
- Monday–Sunday weekly counts: rentals starting, deliveries starting, returns due.
- Overdue rentals with status `out` and past their scheduled end date.
- Next 3 upcoming pickups, deliveries, or returns.
- Expected collections = sum of outstanding balances (total less recorded payments)
  for *non-completed* bookings **starting this week**.
- Dollar labels are rounded to whole CAD with thousands separators.
- Tap header to open the app; tap **+ New Booking** to open the form.

## Build & test (developer workstation required)
1. Install Android Studio, Android SDK 35, JDK 17, and Android Gradle Plugin 8.7+.
2. Open `android-widget/` in Android Studio and let Gradle sync.
3. For preview testing, set `APP_URL` in `app/build.gradle` to the **preview**
   deployment for branch `feature/android-weekly-widget`, with trailing slash.
   The default production URL will not have the widget bridge until this feature
   is deliberately merged.
4. Build a **debug APK** and install on both Android phones.
5. Open Easy Party Kit through the installed app once (internet required);
   widget data is cached on-device.
6. Add the "Easy Party Kit" widget from Android's home-screen widget picker.
7. Test with folded and unfolded screens, overdue returns, partial payments,
   Monday boundary, and newly added bookings.

## Known V1 limitations / privacy
- The widget is **not live updating in the background**. It refreshes from
  Supabase when the companion app opens or when bookings/payments change in
  that app; Android periodic redraws display the last cached data. The widget
  explicitly shows its last sync time.
- Customer names can be visible to someone looking at the home screen; don't
  install on a shared device without reviewing this risk.
- Widget tap actions launch the app. No booking edits happen directly in widget.
- Verify the existing Supabase **authentication/RLS** model before external
  distribution. Do not embed a Supabase service-role key in the APK.
- The APK is not included here: this environment does not have the Android SDK.
- No automated Android UI/device test has yet been performed.

## Security boundary
The native bridge only writes limited snapshot JSON while on the exact trusted
HTTPS host. It does not provide an API to read tokens or database records. The
existing website handles Supabase data access and calculations.
