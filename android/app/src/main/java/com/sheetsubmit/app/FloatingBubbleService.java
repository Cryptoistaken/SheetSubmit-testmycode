package com.sheetsubmit.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Point;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.Display;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Toast;

public class FloatingBubbleService extends Service {

    private static final String TAG = "FloatingBubble";
    private static final String CHANNEL_ID = "bubble";
    private static final int NOTIFICATION_ID = 3;
    private static final long LONG_PRESS_MS = 500L;
    private static final String PREFS_NAME = "sheetsubmit";
    private static final String KEY_FILE = "bubble_file";
    private static final String KEY_CLIP = "bubble_clip";
    private static final String KEY_CLIP_AT = "bubble_clip_at";
    private static final String KEY_BUBBLE_X = "bubble_x";
    private static final String KEY_BUBBLE_Y = "bubble_y";
    private static FloatingBubbleService instance;

    private WindowManager windowManager;
    private View bubbleView;
    private WindowManager.LayoutParams bubbleParams;
    private FrameLayout panelRoot;
    private WebView miniWebView;
    private int touchSlop;
    private float initialRawX;
    private float initialRawY;
    private int initialBubbleX;
    private int initialBubbleY;
    private boolean dragging;
    private boolean longPressFired;
    private boolean panelSuppressPaste;
    private long panelShownAt;
    private boolean panelShowing;
    private long downAt;
    private WebView claudeCodeView;

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, FloatingBubbleService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, FloatingBubbleService.class));
    }

    public static void applyConfig(Context ctx) {
        final FloatingBubbleService s = instance;
        if (s == null || s.bubbleView == null || s.windowManager == null) return;
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() { s.refreshBubbleConfig(); }
        });
    }

    private String claudeCodeHtml() {
        return "<html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>html,body{margin:0;background:transparent;overflow:hidden}#a{width:100%;height:100%;display:grid;place-items:center;font-family:sans-serif;font-size:10px;color:#000}</style></head><body><div id=\"a\"><div id=\"idle\" style=\"width:100%;height:100%;display:grid;place-items:center;background:#DE886D;border-radius:12px\">IDLE</div><div id=\"tap\" style=\"display:none;width:100%;height:100%;display:none;place-items:center;background:#FFD400;border-radius:12px\">TAP</div><div id=\"long\" style=\"display:none;width:100%;height:100%;display:none;place-items:center;background:#90A4AE;border-radius:12px\">SLEEP</div><div id=\"drag\" style=\"display:none;width:100%;height:100%;display:none;place-items:center;background:#A7E0FF;border-radius:12px\">WALK</div></div><script>window.playClaude=function(n,ms){var d={tap:1600,long:2000,drag:600,open:1600};if(ms==null)ms=d[n]||1600;var ids=[\"idle\",\"tap\",\"long\",\"drag\"];for(var i=0;i<ids.length;i++){var e=document.getElementById(ids[i]);if(e)e.style.display=\"none\";}var t=document.getElementById(n)||document.getElementById(\"idle\");if(t)t.style.display=\"grid\";clearTimeout(window._pcT);if(n!==\"idle\"&&ms>0)window._pcT=setTimeout(function(){window.playClaude(\"idle\",0)},ms);}</script></body></html>";
    }
    private void playClaudeCode(String name) {
        try { if (claudeCodeView != null) claudeCodeView.evaluateJavascript("window.playClaude('" + name + "')", null); } catch (Exception ignored) {}
    }
    private void playClaudeCode(String name, int revertMs) {
        try { if (claudeCodeView != null) claudeCodeView.evaluateJavascript("window.playClaude('" + name + "'," + revertMs + ")", null); } catch (Exception ignored) {}
    }
    private void refreshBubbleConfig() {
        try {
            SharedPreferences p = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String icon = p.getString("bubble_icon", "logo");
            String color = p.getString("bubble_color", "#ef4444");
            int sz = p.getInt("bubble_size", 60);
            int col = Color.parseColor(color);
            int margin = dp(12);
            int winSize = dp(sz) + margin * 2;
            int iconPx = dp(sz * 0.95f);
            if (bubbleView instanceof FrameLayout) {
                FrameLayout root = (FrameLayout) bubbleView;
                if (claudeCodeView != null) { try { claudeCodeView.destroy(); } catch (Exception ignored) {} claudeCodeView = null; }
                root.removeAllViews();
                if ("logo".equals(icon)) {
                    FrameLayout wrap = new FrameLayout(this);
                    GradientDrawable bg = new GradientDrawable();
                    bg.setColor(col);
                    bg.setCornerRadius(iconPx * 0.25f);
                    wrap.setBackground(bg);
                    FrameLayout.LayoutParams wlp = new FrameLayout.LayoutParams(iconPx, iconPx, Gravity.CENTER);
                    wrap.setLayoutParams(wlp);
                    LinearLayout lines = new LinearLayout(this);
                    lines.setOrientation(LinearLayout.VERTICAL);
                    lines.setGravity(Gravity.CENTER);
                    FrameLayout.LayoutParams llp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
                    lines.setLayoutParams(llp);
                    int lineW = Math.round(iconPx * 0.50f);
                    int lineWS = Math.round(iconPx * 0.35f);
                    int lineH = Math.max(dp(2), Math.round(iconPx * 0.07f));
                    int gap = Math.round(iconPx * 0.10f);
                    for (int i = 0; i < 3; i++) {
                        View v = new View(this);
                        GradientDrawable vg = new GradientDrawable();
                        vg.setColor(0xFFFFFFFF);
                        vg.setCornerRadius(lineH / 2f);
                        v.setBackground(vg);
                        LinearLayout.LayoutParams vlp = new LinearLayout.LayoutParams(i == 2 ? lineWS : lineW, lineH);
                        if (i > 0) vlp.topMargin = gap;
                        v.setLayoutParams(vlp);
                        lines.addView(v);
                    }
                    wrap.addView(lines);
                    root.addView(wrap);
                } else if ("claudeCode".equals(icon)) {
                    WebView wv = new WebView(this);
                    wv.setBackgroundColor(Color.TRANSPARENT);
                    try { wv.setLayerType(View.LAYER_TYPE_SOFTWARE, null); } catch (Exception ignored) {}
                    WebSettings ws = wv.getSettings();
                    ws.setJavaScriptEnabled(true);
                    wv.setVerticalScrollBarEnabled(false);
                    wv.setHorizontalScrollBarEnabled(false);
                    wv.setOnTouchListener(new View.OnTouchListener(){ @Override public boolean onTouch(View v, MotionEvent e){ return false; }});
                    FrameLayout.LayoutParams wlp = new FrameLayout.LayoutParams(iconPx, iconPx, Gravity.CENTER);
                    wv.setLayoutParams(wlp);
                    wv.loadDataWithBaseURL(null, claudeCodeHtml(), "text/html", "utf-8", null);
                    claudeCodeView = wv;
                    root.addView(wv);
                } else {
                    ImageView iv = new ImageView(this);
                    int res = R.drawable.bubble_icon;
                    if ("pacman".equals(icon)) res = R.drawable.bubble_pacman;
                    else if ("logo".equals(icon)) res = R.drawable.bubble_logo;
                    iv.setImageResource(res);
                    try { iv.setColorFilter(col, PorterDuff.Mode.SRC_IN); } catch (Exception ignored) {}
                    if ("logo".equals(icon)) try { iv.clearColorFilter(); } catch (Exception ignored) {}
                    FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(iconPx, iconPx, Gravity.CENTER);
                    iv.setLayoutParams(ilp);
                    root.addView(iv);
                }
            }
            bubbleParams.width = winSize;
            bubbleParams.height = winSize;
            bubbleParams.x = clamp(bubbleParams.x, 0, Math.max(0, displayWidth() - winSize));
            bubbleParams.y = clamp(bubbleParams.y, 0, Math.max(0, displayHeight() - winSize));
            windowManager.updateViewLayout(bubbleView, bubbleParams);
        } catch (Exception e) { Log.e(TAG, "refreshBubbleConfig: " + e.getMessage()); }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !android.provider.Settings.canDrawOverlays(this)) {
            Log.e(TAG, "overlay permission missing, stopping");
            stopSelf();
            return;
        }

        String bubbleFileId = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(KEY_FILE, "");
        if (bubbleFileId.isEmpty()) {
            Log.i(TAG, "No bubble file set, stopping");
            stopSelf();
            return;
        }

        createChannel();
        startAsForeground();

        DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        Display display = dm.getDisplay(Display.DEFAULT_DISPLAY);
        Context displayCtx = createDisplayContext(display);
        windowManager = (WindowManager) displayCtx.getSystemService(Context.WINDOW_SERVICE);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();

        addBubbleToWindow();
        // Preload the selected file's mini-window page now (right after the
        // bubble is enabled) instead of lazily on the first tap — the panel
        // then shows the already-loaded sheet when the user opens it.
        ensureMiniWebView();
        Log.i(TAG, "service running, bubble visible");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ── Bubble ──

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @SuppressWarnings("deprecation")
    private int displayWidth() {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                return windowManager.getCurrentWindowMetrics().getBounds().width();
            }
            Point p = new Point();
            windowManager.getDefaultDisplay().getSize(p);
            return p.x;
        } catch (Exception e) {
            return getResources().getDisplayMetrics().widthPixels;
        }
    }

    @SuppressWarnings("deprecation")
    private int displayHeight() {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                return windowManager.getCurrentWindowMetrics().getBounds().height();
            }
            Point p = new Point();
            windowManager.getDefaultDisplay().getSize(p);
            return p.y;
        } catch (Exception e) {
            return getResources().getDisplayMetrics().heightPixels;
        }
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void addBubbleToWindow() {
        SharedPreferences cfg = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String cfgIcon = cfg.getString("bubble_icon", "claude");
        String cfgColor = cfg.getString("bubble_color", "#ef4444");
        int cfgSize = cfg.getInt("bubble_size", 60);
        int size = dp(cfgSize);
        int margin = dp(12);
        int windowSize = size + margin * 2;

        FrameLayout root = new FrameLayout(this);
        root.setClipChildren(false);

        int iconPx = dp(cfgSize * 0.95f);
        if ("logo".equals(cfgIcon)) {
            FrameLayout wrap = new FrameLayout(this);
            GradientDrawable bg = new GradientDrawable();
            try { bg.setColor(Color.parseColor(cfgColor)); } catch (Exception ignored) { bg.setColor(0xFF000000); }
            bg.setCornerRadius(iconPx * 0.25f);
            wrap.setBackground(bg);
            FrameLayout.LayoutParams wlp = new FrameLayout.LayoutParams(iconPx, iconPx, Gravity.CENTER);
            wrap.setLayoutParams(wlp);
            LinearLayout lines = new LinearLayout(this);
            lines.setOrientation(LinearLayout.VERTICAL);
            lines.setGravity(Gravity.CENTER);
            FrameLayout.LayoutParams llp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
            lines.setLayoutParams(llp);
            int lineW = Math.round(iconPx * 0.50f);
            int lineWS = Math.round(iconPx * 0.35f);
            int lineH = Math.max(dp(2), Math.round(iconPx * 0.07f));
            int gap = Math.round(iconPx * 0.10f);
            for (int i = 0; i < 3; i++) {
                View v = new View(this);
                GradientDrawable vg = new GradientDrawable();
                vg.setColor(0xFFFFFFFF);
                vg.setCornerRadius(lineH / 2f);
                v.setBackground(vg);
                LinearLayout.LayoutParams vlp = new LinearLayout.LayoutParams(i == 2 ? lineWS : lineW, lineH);
                if (i > 0) vlp.topMargin = gap;
                v.setLayoutParams(vlp);
                lines.addView(v);
            }
            wrap.addView(lines);
            root.addView(wrap);
        } else if ("claudeCode".equals(cfgIcon)) {
            WebView wv = new WebView(this);
            wv.setBackgroundColor(Color.TRANSPARENT);
            try { wv.setLayerType(View.LAYER_TYPE_SOFTWARE, null); } catch (Exception ignored) {}
            WebSettings ws = wv.getSettings();
            ws.setJavaScriptEnabled(true);
            wv.setVerticalScrollBarEnabled(false);
            wv.setHorizontalScrollBarEnabled(false);
            wv.setOnTouchListener(new View.OnTouchListener(){ @Override public boolean onTouch(View v, MotionEvent e){ return false; }});
            FrameLayout.LayoutParams wlp = new FrameLayout.LayoutParams(iconPx, iconPx, Gravity.CENTER);
            wv.setLayoutParams(wlp);
            wv.loadDataWithBaseURL(null, claudeCodeHtml(), "text/html", "utf-8", null);
            claudeCodeView = wv;
            root.addView(wv);
        } else {
            ImageView icon = new ImageView(this);
            int res = R.drawable.bubble_icon;
            if ("pacman".equals(cfgIcon)) res = R.drawable.bubble_pacman;
            icon.setImageResource(res);
            try { icon.setColorFilter(Color.parseColor(cfgColor), PorterDuff.Mode.SRC_IN); } catch (Exception ignored) {}
            FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(iconPx, iconPx, Gravity.CENTER);
            icon.setLayoutParams(ilp);
            root.addView(icon);
        }

        bubbleParams = new WindowManager.LayoutParams(
                windowSize, windowSize, overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        SharedPreferences posPrefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        bubbleParams.x = posPrefs.getInt(KEY_BUBBLE_X, Math.max(0, displayWidth() - windowSize - dp(16)));
        bubbleParams.y = posPrefs.getInt(KEY_BUBBLE_Y, dp(220));

        root.setOnTouchListener(bubbleTouchListener);
        bubbleView = root;
        try {
            windowManager.addView(bubbleView, bubbleParams);
        } catch (Exception e) {
            Log.e(TAG, "addBubbleToWindow failed", e);
            Toast.makeText(this, "Cannot display overlay — allow the permission", Toast.LENGTH_LONG).show();
            bubbleView = null;
            stopSelf();
        }
    }

    private void hapticFeedback() {
        try {
            if (bubbleView != null) {
                bubbleView.performHapticFeedback(
                        HapticFeedbackConstants.LONG_PRESS,
                        HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING);
            }
        } catch (Exception ignored) {}
        // Fallback for devices/overlays where performHapticFeedback is a no-op
        // (FLAG_NOT_FOCUSABLE windows often swallow haptics).
        try {
            Vibrator vib = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vib != null && vib.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= 26) {
                    vib.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vib.vibrate(30);
                }
            }
        } catch (Exception ignored) {}
    }

    private final Runnable longPressRunnable = new Runnable() {
        @Override
        public void run() {
            // Fired while the finger is STILL DOWN after LONG_PRESS_MS.
            // Long-press = skip 2FA (only applies when the row has a cookie and
            // no key — decided in JS) AND open the mini sheet so the user can
            // see the rows. The panel must NOT capture the clipboard or run
            // paste automation, or it would immediately fill the just-skipped
            // row with an unrelated clip.
            if (bubbleView == null) return;
            longPressFired = true;
            bubbleView.performClick();
            hapticFeedback();
            playClaudeCode("long",2000);
            panelSuppressPaste = true; // panel opens read-only-ish, no paste
            if (miniWebView != null) {
                miniWebView.evaluateJavascript(
                    "window.__ss&&window.__ss.bubbleSkipNo2FA&&window.__ss.bubbleSkipNo2FA();", null);
            }
            if (!panelShowing) showPanel();
        }
    };

    private void cancelLongPress() {
        bubbleView.removeCallbacks(longPressRunnable);
    }

    private final View.OnTouchListener bubbleTouchListener = new View.OnTouchListener() {
        @Override
        public boolean onTouch(View v, MotionEvent ev) {
            switch (ev.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    initialRawX = ev.getRawX();
                    initialRawY = ev.getRawY();
                    initialBubbleX = bubbleParams.x;
                    initialBubbleY = bubbleParams.y;
                    dragging = false;
                    longPressFired = false;
                    downAt = SystemClock.elapsedRealtime();
                    v.animate().scaleX(0.92f).scaleY(0.92f).setDuration(120).start();
                    // Arm the long-press NOW — it fires after LONG_PRESS_MS while
                    // still held, not on release.
                    v.postDelayed(longPressRunnable, LONG_PRESS_MS);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (Math.abs(ev.getRawX() - initialRawX) > touchSlop
                            || Math.abs(ev.getRawY() - initialRawY) > touchSlop) {
                        // A drag is not a long-press — disarm it.
                        cancelLongPress();
                        hidePanel();
                        boolean wasDragging = dragging;
                        dragging = true;
                        if (!wasDragging) playClaudeCode("drag",0);
                        int nx = Math.round(initialBubbleX + (ev.getRawX() - initialRawX));
                        int ny = Math.round(initialBubbleY + (ev.getRawY() - initialRawY));
                        bubbleParams.x = clamp(nx, 0, Math.max(0, displayWidth() - bubbleParams.width));
                        bubbleParams.y = clamp(ny, 0, Math.max(0, displayHeight() - bubbleParams.height));
                        windowManager.updateViewLayout(bubbleView, bubbleParams);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    cancelLongPress();
                    v.animate().scaleX(1f).scaleY(1f).setDuration(150).start();
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                            .putInt(KEY_BUBBLE_X, bubbleParams.x)
                            .putInt(KEY_BUBBLE_Y, bubbleParams.y)
                            .apply();
                    if (!dragging && !longPressFired) {
                        playClaudeCode("tap",1600);
                        // Short tap only — a long-press already ran its skip while
                        // held and consumed this gesture, so release does NOT open
                        // the panel or paste anything.
                        v.performClick();
                        togglePanel();
                    } else if (dragging) {
                        playClaudeCode("drag",600);
                    }
                    dragging=false;
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    cancelLongPress();
                    dragging = false;
                    longPressFired = false;
                    v.animate().scaleX(1f).scaleY(1f).setDuration(150).start();
                    return true;
            }
            return false;
        }
    };

    private int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(v, max));
    }

    // ── Mini panel ──

    private void togglePanel() {
        if (panelRoot != null || panelShowing) {
            hidePanel();
        } else {
            playClaudeCode("tap",1600);
            showPanel();
        }
    }

    private void showPanel() {
        if (panelShowing) return;
        panelShowing = true;
        playClaudeCode("tap",1600);
        try {
            int scrW = displayWidth();
            int scrH = displayHeight();
            int panelW = Math.min(dp(220), Math.max(200, scrW - dp(20)));
            panelW = Math.min(panelW, scrW - dp(8));
            int panelH = Math.min(dp(280), Math.max(240, scrH - dp(40)));
            panelH = Math.min(panelH, scrH - dp(16));

            panelRoot = new FrameLayout(this);

            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            GradientDrawable cardBg = new GradientDrawable();
            cardBg.setColor(0xFFFFFFFF);
            cardBg.setCornerRadius(dp(16));
            cardBg.setStroke(dp(1), 0xFFE4E4E7);
            card.setBackground(cardBg);
            card.setClipToOutline(true);
            FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(panelW, panelH, Gravity.TOP | Gravity.START);
            int bx = bubbleParams.x + bubbleParams.width / 2;
            int by = bubbleParams.y + bubbleParams.height / 2;
            int gap = dp(8);
            int left, top;
            if (scrW - bx >= panelW + gap) {
                left = bx + gap;
                top = clamp(by - panelH / 2, dp(8), Math.max(dp(8), scrH - panelH - dp(8)));
            } else if (bx >= panelW + gap) {
                left = bx - panelW - gap;
                top = clamp(by - panelH / 2, dp(8), Math.max(dp(8), scrH - panelH - dp(8)));
            } else if (scrH - by >= panelH + gap) {
                left = clamp(bx - panelW / 2, dp(8), Math.max(dp(8), scrW - panelW - dp(8)));
                top = by + gap;
            } else {
                left = clamp(bx - panelW / 2, dp(8), Math.max(dp(8), scrW - panelW - dp(8)));
                top = by - panelH - gap;
            }
            cardParams.leftMargin = left;
            cardParams.topMargin = top;
            card.setLayoutParams(cardParams);

            ensureMiniWebView();
            if (miniWebView != null) {
                ViewGroup oldParent = (ViewGroup) miniWebView.getParent();
                if (oldParent != null) oldParent.removeView(miniWebView);
                LinearLayout.LayoutParams wlp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
                card.addView(miniWebView, wlp);
                miniWebView.onResume();
                panelRoot.requestFocus();
                if (miniWebView != null) miniWebView.requestFocus();
                if (!panelSuppressPaste) {
                    // Tap-opened panel: capture the clipboard and auto-paste.
                    try {
                        Intent cap = new Intent(this, ClipboardCaptureActivity.class);
                        cap.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(cap);
                    } catch (Exception e) {
                        Log.w(TAG, "ClipboardCaptureActivity failed, using fallback", e);
                        try {
                            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                            if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip() != null && cm.getPrimaryClip().getItemCount() > 0) {
                                CharSequence cs = cm.getPrimaryClip().getItemAt(0).getText();
                                String text = cs != null ? cs.toString() : "";
                                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                                    .edit()
                                    .putString(KEY_CLIP, text)
                                    .putLong(KEY_CLIP_AT, System.currentTimeMillis())
                                    .apply();
                            }
                        } catch (Exception ignored) {}
                    }
                }
                if (!panelSuppressPaste) {
                    final int[] pollCount = {0};
                    final Runnable pollRunnable = new Runnable() {
                        @Override
                        public void run() {
                            pollCount[0]++;
                            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                            long clipAt = prefs.getLong(KEY_CLIP_AT, 0);
                            boolean captured = clipAt > 0 && System.currentTimeMillis() - clipAt < 2000;
                            if (captured || pollCount[0] >= 10) {
                                try {
                                    miniWebView.evaluateJavascript("window.__ss&&window.__ss.bubbleAutomate&&window.__ss.bubbleAutomate();", null);
                                } catch (Exception ignored) {}
                            } else {
                                panelRoot.postDelayed(this, 200);
                            }
                        }
                    };
                    panelRoot.postDelayed(pollRunnable, 200);
                }
            }

            panelRoot.addView(card);
            card.setAlpha(0f);
            card.setScaleX(0.9f);
            card.setScaleY(0.9f);
            card.animate().alpha(1f).scaleX(1f).scaleY(1f)
                    .setDuration(120).setInterpolator(new AccelerateDecelerateInterpolator()).start();
            panelRoot.setOnTouchListener(new View.OnTouchListener() {
                @Override
                public boolean onTouch(View v, MotionEvent event) {
                    if (event.getActionMasked() == MotionEvent.ACTION_DOWN
                            && SystemClock.elapsedRealtime() - panelShownAt > 350) {
                        hidePanel();
                        return true;
                    }
                    return false;
                }
            });
            card.setClickable(true);

            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                    overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
            windowManager.addView(panelRoot, lp);
            panelShownAt = SystemClock.elapsedRealtime();
            Log.i(TAG, "panel shown " + panelW + "x" + panelH);
        } catch (Exception e) {
            Log.e(TAG, "showPanel failed", e);
            panelShowing = false;
            if (panelRoot != null) {
                try { windowManager.removeView(panelRoot); } catch (Exception ignored) {}
                panelRoot = null;
            }
        }
    }

    private void ensureMiniWebView() {
        if (miniWebView != null) {
            // Keep the already-loaded page alive — never recreate on reopen.
            // It is only destroyed in onDestroy() (app close / bubble disabled).
            return;
        }
        try {
            miniWebView = new WebView(this);
            miniWebView.setBackgroundColor(0x00000000);
            WebSettings ws = miniWebView.getSettings();
            ws.setJavaScriptEnabled(true);
            ws.setDomStorageEnabled(true);
            ws.setDatabaseEnabled(true);
            ws.setLoadWithOverviewMode(true);
            ws.setUseWideViewPort(true);
            miniWebView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    injectClipboardBridge(view);
                }
            });
            miniWebView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public boolean isApp() { return true; }
                @JavascriptInterface
                public String readClipboard() {
                    try {
                        // Android 10+ only lets focused apps read the clipboard —
                        // prefer the value captured by ClipboardCaptureActivity.
                        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                        long at = prefs.getLong(KEY_CLIP_AT, 0);
                        if (at > 0 && System.currentTimeMillis() - at < 15000) {
                            String captured = prefs.getString(KEY_CLIP, null);
                            if (captured != null) return captured;
                        }
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip() != null && cm.getPrimaryClip().getItemCount() > 0) {
                            CharSequence cs = cm.getPrimaryClip().getItemAt(0).getText();
                            return cs != null ? cs.toString() : "";
                        }
                    } catch (Exception ignored) {}
                    return "";
                }
                @JavascriptInterface
                public void writeClipboard(String text) {
                    try {
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("sheetsubmit", text == null ? "" : text));
                    } catch (Exception ignored) {}
                }
            }, "Android");
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String fileId = prefs.getString(KEY_FILE, "");
            if (!fileId.isEmpty()) {
                String url = Config.HOME_URL + "/?bubble=1&file=" + Uri.encode(fileId);
                miniWebView.loadUrl(url);
                Log.i(TAG, "mini webview loading " + url);
            }
        } catch (Exception e) {
            Log.e(TAG, "ensureMiniWebView failed", e);
            miniWebView = null;
        }
    }

    private void injectClipboardBridge(WebView view) {
        String shim = "(function(){" +
            "if(window.Android&&window.Android.readClipboard&&window.Android.writeClipboard){" +
            "navigator.clipboard.readText=function(){return new Promise(function(res,rej){try{res(window.Android.readClipboard());}catch(e){rej(e);}});};" +
            "navigator.clipboard.writeText=function(t){window.Android.writeClipboard(String(t));return Promise.resolve();};" +
            "navigator.clipboard.read=function(){return Promise.reject(new Error('not supported'));};" +
            "window.nativeClipboardReady=true;}" +
            "})();";
        view.evaluateJavascript(shim, null);
    }

    private void hidePanel() {
        if (miniWebView != null) {
            // Keep the page rendered — only pause JS timers while hidden.
            // The WebView itself stays alive until the app closes or the
            // bubble is disabled, so the sheet is shown instantly next time.
            try { miniWebView.onPause(); } catch (Exception ignored) {}
        }
        if (panelRoot != null) {
            try { windowManager.removeView(panelRoot); } catch (Exception ignored) {}
            panelRoot = null;
        }
        // MUST reset — otherwise togglePanel() never opens the panel again
        // after the first close (panelShowing remains true forever).
        panelShowing = false;
        // Clear the long-press "no paste" flag — the next TAP opens a normal
        // panel that captures the clipboard and auto-pastes again.
        panelSuppressPaste = false;
    }

    // ── Foreground notification ──

    private void createChannel() {
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Floating bubble", NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(ch);
    }

    private void startAsForeground() {
        Intent openApp = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.bubble_icon)
                .setContentTitle("SheetSubmit bubble")
                .setContentText("Mini sheet is active")
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        hidePanel();
        if (miniWebView != null) {
            miniWebView.destroy();
            miniWebView = null;
        }
        if (bubbleView != null) {
            try { windowManager.removeView(bubbleView); } catch (Exception ignored) {}
            bubbleView = null;
        }
        if (claudeCodeView != null) { try { claudeCodeView.destroy(); } catch (Exception ignored) {} claudeCodeView = null; }
        super.onDestroy();
    }
}