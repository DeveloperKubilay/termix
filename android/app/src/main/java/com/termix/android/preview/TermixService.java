package com.termix.android.preview;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

public final class TermixService extends Service {
    private static final String TAG = "TermixService";
    private static final String CHANNEL_ID = "termix_foreground_service";
    private static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_UPDATE_STATE = "com.termix.android.preview.action.UPDATE_STATE";
    public static final String ACTION_STOP = "com.termix.android.preview.action.STOP";
    public static final String ACTION_STOP_ALL = "com.termix.android.preview.action.STOP_ALL";
    public static final String ACTION_RESTORE_NOTIFICATION = "com.termix.android.preview.action.RESTORE_NOTIFICATION";

    public static final String EXTRA_TERMINALS = "extra_terminals";
    public static final String EXTRA_SFTP = "extra_sftp";
    public static final String EXTRA_TRANSFERS = "extra_transfers";

    private PowerManager.WakeLock wakeLock;
    private int currentTerminals = 0;
    private int currentSftp = 0;
    private int currentTransfers = 0;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_STOP.equals(action)) {
                stopSelfAndForeground();
                return START_NOT_STICKY;
            } else if (ACTION_STOP_ALL.equals(action)) {
                stopAllAndSelf();
                return START_NOT_STICKY;
            } else if (ACTION_UPDATE_STATE.equals(action)) {
                int terminals = intent.getIntExtra(EXTRA_TERMINALS, 0);
                int sftp = intent.getIntExtra(EXTRA_SFTP, 0);
                int transfers = intent.getIntExtra(EXTRA_TRANSFERS, 0);
                handleStateUpdate(terminals, sftp, transfers, startId);
                return START_NOT_STICKY;
            } else if (ACTION_RESTORE_NOTIFICATION.equals(action)) {
                if (currentTerminals > 0 || currentSftp > 0 || currentTransfers > 0) {
                    Notification notification = buildNotification(currentTerminals, currentSftp, currentTransfers);
                    try {
                        startForeground(NOTIFICATION_ID, notification);
                    } catch (Exception e) {
                        Log.w(TAG, "Failed to restore persistent notification: " + e.getMessage());
                    }
                }
                return START_NOT_STICKY;
            }
        }
        return START_NOT_STICKY;
    }

    private void handleStateUpdate(int terminals, int sftp, int transfers, int startId) {
        currentTerminals = Math.max(0, terminals);
        currentSftp = Math.max(0, sftp);
        currentTransfers = Math.max(0, transfers);

        if (currentTerminals <= 0 && currentSftp <= 0 && currentTransfers <= 0) {
            stopSelfAndForeground();
            return;
        }

        acquireWakeLock();
        Notification notification = buildNotification(currentTerminals, currentSftp, currentTransfers);

        int foregroundType = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (Build.VERSION.SDK_INT >= 34) { // Android 14+ (UPSIDE_DOWN_CAKE)
                if (currentTransfers > 0) {
                    foregroundType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                }
                if (currentTerminals > 0 || currentSftp > 0) {
                    foregroundType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
                }
                if (foregroundType == 0) {
                    foregroundType = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
                }
            } else {
                foregroundType = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            }
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && foregroundType != 0) {
                startForeground(NOTIFICATION_ID, notification, foregroundType);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.w(TAG, "startForeground failed: " + e.getMessage());
        }
    }

    private synchronized void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "termix:background_wake_lock");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(6 * 60 * 60 * 1000L); // Safety timeout of 6 hours
        }
    }

    private synchronized void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
    }

    private void stopAllAndSelf() {
        try {
            TermixApplication app = (TermixApplication) getApplication();
            if (app != null && app.runtime() != null) {
                app.runtime().stopAllConnections();
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to stop all connections: " + e.getMessage());
        }
        stopSelfAndForeground();
    }

    private void stopSelfAndForeground() {
        releaseWakeLock();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Termix Active Sessions",
                        NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Keeps active SSH/SFTP terminal sessions and file transfers connected when the app is in the background or screen is off.");
                channel.setShowBadge(false);
                channel.setSound(null, null);
                channel.enableVibration(false);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(int terminals, int sftp, int transfers) {
        createNotificationChannel();

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Intent stopIntent = new Intent(this, TermixService.class);
        stopIntent.setAction(ACTION_STOP_ALL);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Intent restoreIntent = new Intent(this, TermixService.class);
        restoreIntent.setAction(ACTION_RESTORE_NOTIFICATION);
        PendingIntent deletePendingIntent = PendingIntent.getService(
                this, 2, restoreIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        StringBuilder text = new StringBuilder();
        if (transfers > 0 && terminals > 0) {
            text.append(terminals).append(terminals == 1 ? " terminal session, " : " terminal sessions, ")
                .append(transfers).append(transfers == 1 ? " transfer active" : " transfers active");
        } else if (transfers > 0) {
            text.append(transfers).append(transfers == 1 ? " file transfer in progress" : " file transfers in progress");
        } else if (terminals > 0) {
            text.append(terminals).append(terminals == 1 ? " terminal session active" : " terminal sessions active");
        } else if (sftp > 0) {
            text.append(sftp).append(sftp == 1 ? " SFTP session active" : " SFTP sessions active");
        } else {
            text.append("Active background session");
        }

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        builder.setContentTitle("Termix")
               .setContentText(text.toString())
               .setSmallIcon(R.drawable.ic_launcher_foreground)
               .setContentIntent(contentIntent)
               .setDeleteIntent(deletePendingIntent)
               .setOngoing(true)
               .setAutoCancel(false)
               .setOnlyAlertOnce(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            builder.setVisibility(Notification.VISIBILITY_PUBLIC);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Notification.Action stopAction = new Notification.Action.Builder(
                    null,
                    "Stop All",
                    stopPendingIntent
            ).build();
            builder.addAction(stopAction);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            Notification.Action stopAction = new Notification.Action.Builder(
                    0,
                    "Stop All",
                    stopPendingIntent
            ).build();
            builder.addAction(stopAction);
        }

        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_NO_CLEAR | Notification.FLAG_ONGOING_EVENT;
        return notification;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "Foreground service timed out for type " + fgsType);
        stopAllAndSelf();
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        super.onDestroy();
    }

    public static void updateState(Context context, int terminals, int sftp, int transfers) {
        if (context == null) return;
        Intent intent = new Intent(context, TermixService.class);
        if (terminals > 0 || sftp > 0 || transfers > 0) {
            intent.setAction(ACTION_UPDATE_STATE);
            intent.putExtra(EXTRA_TERMINALS, terminals);
            intent.putExtra(EXTRA_SFTP, sftp);
            intent.putExtra(EXTRA_TRANSFERS, transfers);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent);
                } else {
                    context.startService(intent);
                }
            } catch (Exception e) {
                Log.w(TAG, "Cannot start foreground service: " + e.getMessage());
            }
        } else {
            intent.setAction(ACTION_STOP);
            try {
                context.startService(intent);
            } catch (Exception e) {
                Log.w(TAG, "Cannot stop foreground service: " + e.getMessage());
            }
        }
    }
}
