import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "@/lib/toast";

type IconId = "claude" | "claudeCode" | "pacman" | "logo";
interface BubbleCfg { icon: IconId; color: string; size: number; x: number | null; y: number | null; }

const DEFAULT: BubbleCfg = { icon: "logo", color: "#ef4444", size: 60, x: null, y: null };
const COLORS = ["#000000","#1e293b","#334155","#64748b","#ffffff","#fff000","#fde68a","#f59e0b","#f97316","#ea580c","#ef4444","#dc2626","#e11d48","#be185d","#E89B83","#C46044","#a855f7","#7e22ce","#8b5cf6","#4f46e5","#2563eb","#1d4ed8","#06b6d4","#0891b2","#0e7490","#047857","#22c55e","#16a34a"];

const ICON_CLAUDE = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" rx="230" fill="currentColor"/><g fill="#111111"><rect x="250" y="350" width="120" height="240" rx="20"/><rect x="650" y="350" width="120" height="240" rx="20"/></g><g fill="#FFFFFF"><rect x="270" y="380" width="40" height="60" rx="10"/><rect x="670" y="380" width="40" height="60" rx="10"/></g><path d="M -50 600 L 150 600 L 150 800 L -50 800 Z" fill="#C46044"/><path d="M 874 600 L 1074 600 L 1074 800 L 874 800 Z" fill="#C46044"/></svg>`;
const ICON_PACMAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="100%" height="100%"><path fill="currentColor" d="M 150,150 L 236.6,100 A 100 100 0 1 0 236.6,200 Z"/><circle cx="180" cy="110" r="12" fill="#000"/><circle cx="183" cy="106" r="3.5" fill="#fff" opacity="0.9"/></svg>`;
const ICON_LOGO = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/><path d="M7 8h10M7 12h10M7 16h7" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICONS: Record<string,string> = { claude: ICON_CLAUDE, pacman: ICON_PACMAN, logo: ICON_LOGO };
const CLAW_IDLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45" width="500" height="500"> <defs> <style> /* 16-Second Master Sequence for Idle Actions */ .action-body { transform-origin: 7.5px 13px; /* Pivot at the base of the torso */ animation: action-body 16s infinite ease-in-out; } /* Continuous Subtle Breathing (Syncs exactly 5 times per 16s loop) */ .breathe-anim { transform-origin: 7.5px 13px; animation: breathe 3.2s infinite ease-in-out; } /* Shadow shrinking and shifting matching actions */ .shadow-anim { transform-origin: 7.5px 15.5px; animation: shadow-action 16s infinite ease-in-out; } /* Left Arm (Scratching and Yawn Stretching) */ .arm-l { transform-origin: 1px 10px; animation: arm-l-idle 16s infinite ease-in-out; } /* Right Arm (Yawn Stretching) */ .arm-r { transform-origin: 14px 10px; animation: arm-r-idle 16s infinite ease-in-out; } /* Eye Tracking (Looking around) */ .eyes-look { animation: eye-track 16s infinite ease-in-out; } /* Occasional Blinks and shutting during Yawn */ .eyes-blink { transform-origin: 7.5px 9px; animation: eye-blink 16s infinite linear; } /* Yawn Mouth Appearance */ .yawn-mouth { transform-origin: 7.5px 11px; animation: yawn-mouth-anim 16s infinite ease-in-out; opacity: 0; } /* Tiny tear that appears during the big yawn */ .yawn-tear { animation: tear-fall 16s infinite ease-in-out; opacity: 0; } /* --- Keyframes --- */ @keyframes breathe { 0%, 100% { transform: scale(1, 1) translate(0, 0); } 50% { transform: scale(1.02, 0.98) translate(0, 0.5px); } } @keyframes action-body { 0%, 8%, 26%, 38%, 55%, 80%, 100% { transform: scale(1, 1) translate(0, 0); } /* Look Right Tilt */ 12%, 22% { transform: scale(1, 1) translate(1px, 0); } /* Look Left Tilt */ 42%, 50% { transform: scale(1, 1) translate(-1px, 0); } /* Scratching Lean */ 30%, 36% { transform: scale(1, 1) translate(0.5px, 0); } /* Deep Yawn Stretch */ 60% { transform: scale(0.95, 1.05) translate(0px, -1px); } /* Stretch up */ 65% { transform: scale(0.9, 1.1) translate(0px, -2px); } /* Peak stretch */ 72% { transform: scale(1.05, 0.95) translate(0px, 1px); } /* Heavy sigh / squash down */ 76% { transform: scale(1, 1) translate(0px, 0px); } /* Recover */ } @keyframes shadow-action { 0%, 8%, 26%, 38%, 55%, 80%, 100% { transform: scaleX(1) translate(0, 0); opacity: 0.5; } 12%, 22% { transform: scaleX(1) translate(1px, 0); opacity: 0.5; } 42%, 50% { transform: scaleX(1) translate(-1px, 0); opacity: 0.5; } 30%, 36% { transform: scaleX(1) translate(0.5px, 0); opacity: 0.5; } 60% { transform: scaleX(0.95) translate(0, 0); opacity: 0.45; } 65% { transform: scaleX(0.9) translate(0, 0); opacity: 0.4; } 72% { transform: scaleX(1.05) translate(0, 0); opacity: 0.55; } 76% { transform: scaleX(1) translate(0, 0); opacity: 0.5; } } @keyframes eye-track { 0%, 10%, 25%, 38%, 52%, 58%, 80%, 100% { transform: translate(0px, 0px); } 12%, 22% { transform: translate(3px, 0px); } /* Look Right */ 42%, 50% { transform: translate(-3px, 0px); } /* Look Left */ 60%, 75% { transform: translate(0px, -1px); } /* Look slightly up during yawn */ } @keyframes eye-blink { 0%, 3%, 7%, 18%, 22%, 43%, 47%, 56%, 83%, 87%, 100% { transform: scaleY(1); } 5%, 20%, 45%, 85% { transform: scaleY(0.1); } /* Quick Blinks */ /* Yawn Closed Eyes */ 60% { transform: scaleY(1); } 62%, 72% { transform: scaleY(0.1); } /* Eyes completely shut */ 75% { transform: scaleY(1); } } @keyframes arm-l-idle { 0%, 28% { transform: translate(0, 0) rotate(0deg); } /* Occasional Scratching Sequence (Left Arm) */ 30% { transform: translate(1px, -3px) rotate(15deg); } 31% { transform: translate(1.5px, -4px) rotate(35deg); } /* Up */ 32% { transform: translate(0.5px, -2.5px) rotate(0deg); } /* Down */ 33% { transform: translate(1.5px, -4px) rotate(35deg); } 34% { transform: translate(0.5px, -2.5px) rotate(0deg); } 35% { transform: translate(1.5px, -4px) rotate(35deg); } 36% { transform: translate(0.5px, -2.5px) rotate(0deg); } 38%, 58% { transform: translate(0, 0) rotate(0deg); } /* Yawn Stretch */ 62% { transform: translate(-1px, -2px) rotate(45deg); } 65% { transform: translate(-2px, -3px) rotate(80deg); } /* Full outward stretch */ 72% { transform: translate(0px, 1px) rotate(-15deg); } /* Relax down */ 76%, 100% { transform: translate(0, 0) rotate(0deg); } } @keyframes arm-r-idle { 0%, 58% { transform: translate(0, 0) rotate(0deg); } /* Yawn Stretch */ 62% { transform: translate(1px, -2px) rotate(-45deg); } 65% { transform: translate(2px, -3px) rotate(-80deg); } /* Full outward stretch */ 72% { transform: translate(0px, 1px) rotate(15deg); } /* Relax down */ 76%, 100% { transform: translate(0, 0) rotate(0deg); } } @keyframes yawn-mouth-anim { 0%, 58%, 76%, 100% { opacity: 0; transform: scale(0.1); } 60% { opacity: 1; transform: scale(0.5, 0.2); } 65% { opacity: 1; transform: scale(1.1, 1.4); } /* Wide Open */ 72% { opacity: 1; transform: scale(0.6, 0.4); } /* Shrinking */ 75% { opacity: 0; transform: scale(0.1); } } @keyframes tear-fall { 0%, 64%, 80%, 100% { opacity: 0; transform: translateY(0); } 66% { opacity: 1; transform: translateY(0); } /* Appears at corner of eye */ 72% { opacity: 1; transform: translateY(2.5px); } /* Slides down cheek */ 75% { opacity: 0; transform: translateY(3px); } /* Fades out */ } </style> </defs> <!-- Ground Shadow --> <rect id="ground-shadow" class="shadow-anim" x="3" y="15" width="9" height="1" fill="#000000" opacity="0.5"/> <!-- Static Character Legs (Planted firmly while the body stretches above) --> <g id="legs" fill="#DE886D"> <rect id="outer-left-leg" x="3" y="13" width="1" height="2"/> <rect id="inner-left-leg" x="5" y="13" width="1" height="2"/> <rect id="inner-right-leg" x="9" y="13" width="1" height="2"/> <rect id="outer-right-leg" x="11" y="13" width="1" height="2"/> </g> <!-- Animated Upper Body (Combines occasional actions + continuous breathing) --> <g class="action-body"> <g class="breathe-anim"> <!-- Torso --> <rect id="torso" x="2" y="6" width="11" height="7" fill="#DE886D"/> <!-- Arms --> <g class="arm-l"> <rect id="left-arm" x="0" y="9" width="2" height="2" fill="#DE886D"/> </g> <g class="arm-r"> <rect id="right-arm" x="13" y="9" width="2" height="2" fill="#DE886D"/> </g> <!-- Yawning Mouth (Hidden usually) --> <rect class="yawn-mouth" x="6" y="10" width="3" height="2" fill="#000000"/> <!-- Eyes Group --> <g class="eyes-look" fill="#000000"> <g class="eyes-blink"> <rect id="left-eye" x="4" y="8" width="1" height="2"/> <rect id="right-eye" x="10" y="8" width="1" height="2"/> </g> </g> <!-- Yawn Tear Drop (A tiny detail for the big stretch) --> <rect class="yawn-tear" x="3.5" y="10" width="1" height="1" fill="#40C4FF"/> </g> </g> </svg>`;
const CLAW_TAP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45" width="500" height="500"> <defs> <style> .body-breathe { transform-box: view-box; transform-origin: 7.5px 12px; animation: body-breathe 6s infinite ease-in-out; } @keyframes body-breathe { 0%, 18%, 84%, 100% { transform: translateY(0); } 38%, 64% { transform: translateY(-0.28px); } 72% { transform: translateY(-0.12px); } } #ground-shadow { transform-box: view-box; transform-origin: 7.5px 15.5px; animation: shadow-breathe 6s infinite ease-in-out; } @keyframes shadow-breathe { 0%, 18%, 84%, 100% { opacity: 0.5; transform: scaleX(1); } 38%, 64% { opacity: 0.36; transform: scaleX(0.86); } 72% { opacity: 0.44; transform: scaleX(0.94); } } .body-tilt { transform-box: view-box; transform-origin: 7.5px 13px; animation: body-tilt 6s infinite ease-in-out; } @keyframes body-tilt { 0%, 22%, 76%, 100% { transform: rotate(0deg) scaleY(1); } 30% { transform: rotate(3deg) scaleY(0.97); } 39% { transform: rotate(4.5deg) scaleY(0.97); } 48% { transform: rotate(2deg) scaleY(0.97); } 57% { transform: rotate(4deg) scaleY(0.97); } 66% { transform: rotate(3deg) scaleY(0.97); } } .leg-left-inner { transform-box: fill-box; transform-origin: 50% 0%; animation: leg-left-inner 6s infinite ease-in-out; } @keyframes leg-left-inner { 0%, 22%, 76%, 100% { transform: rotate(0deg); } 30% { transform: rotate(12deg); } 36% { transform: rotate(15deg); } 42% { transform: rotate(9deg); } 48% { transform: rotate(15deg); } 54% { transform: rotate(9deg); } 60% { transform: rotate(15deg); } 66% { transform: rotate(12deg); } } .leg-left-outer { transform-box: fill-box; transform-origin: 50% 0%; animation: leg-left-outer 6s infinite ease-in-out; } @keyframes leg-left-outer { 0%, 22%, 76%, 100% { transform: rotate(0deg); } 30% { transform: rotate(22deg); } 36% { transform: rotate(26deg); } 42% { transform: rotate(19deg); } 48% { transform: rotate(26deg); } 54% { transform: rotate(19deg); } 60% { transform: rotate(26deg); } 66% { transform: rotate(22deg); } } .arm-l-balance { transform-box: fill-box; transform-origin: 100% 0%; animation: arm-l-balance 6s infinite ease-in-out; } @keyframes arm-l-balance { 0%, 22%, 76%, 100% { transform: translate(0, 0) rotate(0deg); } 30% { transform: translate(0, 0.5px) rotate(-2deg); } 37% { transform: translate(0, 0.55px) rotate(1deg); } 44% { transform: translate(0, 0.5px) rotate(-3deg); } 51% { transform: translate(0, 0.55px) rotate(2deg); } 58% { transform: translate(0, 0.5px) rotate(-1deg); } 66% { transform: translate(0, 0.5px) rotate(0deg); } } .arm-r { transform-origin: 13px 10px; animation: arm-r 6s infinite ease-in-out; } @keyframes arm-r { 0%, 8% { transform: none; } 16%, 22% { transform: translateY(-3px) rotate(-90deg); } 30%, 66% { transform: translateY(-4.5px) rotate(-90deg); } 76% { transform: translateY(-3px) rotate(-90deg); } 80%, 100% { transform: none; } } .lightbulb-zone { transform-box: view-box; transform-origin: 0 0; animation: lightbulb-zone 6s infinite ease-in-out; } @keyframes lightbulb-zone { 0%, 22%, 76%, 100% { transform: translate(0, 0); } 30% { transform: translate(0, -1.5px); } 39% { transform: translate(0.3px, -1.7px); } 48% { transform: translate(-0.2px, -1.3px); } 57% { transform: translate(0.3px, -1.6px); } 66% { transform: translate(0, -1.5px); } } .eyes-rect { transform-box: view-box; transform-origin: 7.5px 9px; animation: eyes-rect-move 6s infinite ease-in-out, eyes-rect-vis 6s infinite step-end; } @keyframes eyes-rect-move { 0%, 17% { transform: translate(0, 0) scaleY(1); } 22%, 30% { transform: translate(1px, -0.5px) scaleY(1); } 34% { transform: translate(0, 0) scaleY(1); } 36% { transform: translate(0, 0) scaleY(0.1); } 72% { transform: translate(0, 0) scaleY(0.1); } 74%, 100% { transform: translate(0, 0) scaleY(1); } } @keyframes eyes-rect-vis { 0%, 36% { opacity: 1; } 37%, 72% { opacity: 0; } 73%, 100% { opacity: 1; } } .eyes-smile { opacity: 0; animation: eyes-smile-vis 6s infinite step-end; } @keyframes eyes-smile-vis { 0%, 36% { opacity: 0; } 37%, 72% { opacity: 1; } 73%, 100% { opacity: 0; } } .bulb { transform-box: view-box; transform-origin: 0 0; opacity: 0; animation: bulb-fly 6s infinite ease-in-out; } @keyframes bulb-fly { 0%, 17% { opacity: 0; transform: translate(9.5px, -2.7px) scale(0.15); } 19% { opacity: 1; transform: translate(9.5px, -2.7px) scale(0.27); } 22%, 66% { opacity: 1; transform: translate(9.5px, -2.7px) scale(0.24); } 70%, 100% { opacity: 0; transform: translate(9.5px, -2.7px) scale(0.2); } } .bulb rect[fill="#FFB000"] { animation: glass-edge 6s infinite step-end; } .bulb rect[fill="#FFD400"] { animation: glass-main 6s infinite step-end; } .bulb rect[fill="#E88900"] { animation: glass-shadow 6s infinite step-end; } .bulb rect[fill="#FFFFFF"], .bulb rect[fill="#FFF8B8"] { animation: glass-highlight 6s infinite step-end; } @keyframes glass-main { 0%, 23% { fill: #8A7428; } 24%, 70% { fill: #FFD400; } 71%, 100% { fill: #8A7428; } } @keyframes glass-edge { 0%, 23% { fill: #725B20; } 24%, 70% { fill: #FFB000; } 71%, 100% { fill: #725B20; } } @keyframes glass-shadow { 0%, 23% { fill: #56451D; } 24%, 70% { fill: #E88900; } 71%, 100% { fill: #56451D; } } @keyframes glass-highlight { 0%, 23% { opacity: 0.25; } 24%, 70% { opacity: 1; } 71%, 100% { opacity: 0.25; } } .f-anim { animation: filament-f 6s infinite step-end; } @keyframes filament-f { 0%, 23% { fill: #555; } 24%, 70% { fill: #C96E00; } 71%, 100% { fill: #555; } } .fg-anim { animation: filament-fg 6s infinite step-end; } @keyframes filament-fg { 0%, 23% { fill: #777; } 24%, 70% { fill: #E89500; } 71%, 100% { fill: #777; } } .rays { transform-box: view-box; transform-origin: 13.5px 0.5px; opacity: 0; animation: rays-burst 6s infinite ease-in-out; } @keyframes rays-burst { 0%, 28% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } 29%, 30% { opacity: 0.9; transform: translate(-0.1px, -0.1px) scale(0.9); } 31%, 32% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } 33%, 34% { opacity: 0.9; transform: translate(-0.1px, -0.1px) scale(0.95); } 35%, 36% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } 37%, 38% { opacity: 0.9; transform: translate(-0.1px, -0.1px) scale(0.9); } 39%, 40% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } 41%, 42% { opacity: 0.9; transform: translate(-0.1px, -0.1px) scale(0.95); } 43%, 44% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } 45%, 46% { opacity: 0.9; transform: translate(-0.1px, -0.1px) scale(0.9); } 47%, 48% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } 49%, 50% { opacity: 0.9; transform: translate(-0.1px, -0.1px) scale(0.95); } 51%, 52% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } 53%, 54% { opacity: 0.9; transform: translate(-0.1px, -0.1px) scale(0.9); } 55%, 56% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } 57%, 60% { opacity: 1; transform: translate(-0.1px, -0.1px) scale(0.95); } 61%, 100% { opacity: 0; transform: translate(-0.1px, -0.1px) scale(0.65); } } </style> </defs> <rect id="ground-shadow" x="3" y="15" width="9" height="1" fill="#000000" opacity="0.5"/> <g id="master-group" transform="translate(15, 0) scale(-1, 1)"> <g class="body-breathe"> <g class="body-tilt"> <rect class="leg-left-outer" x="3" y="13" width="1" height="2" fill="#DE886D"/> <rect class="leg-left-inner" x="5" y="13" width="1" height="2" fill="#DE886D"/> <rect x="2" y="6" width="11" height="7" fill="#DE886D"/> <g class="eyes-rect" fill="#000000"> <rect x="4" y="8" width="1" height="2"/> <rect x="10" y="8" width="1" height="2"/> </g> <g class="eyes-smile" fill="none" stroke="#000000" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"> <polyline points="3.5,9 4.5,8 5.5,9"/> <polyline points="9.5,9 10.5,8 11.5,9"/> </g> <rect class="arm-l-balance" x="0" y="9" width="2" height="2" fill="#DE886D"/> </g> <rect x="9" y="13" width="1" height="2" fill="#DE886D"/> </g> <rect x="11" y="13" width="1" height="2" fill="#DE886D"/> <g class="lightbulb-zone"> <g class="bulb"> <rect fill="#FFB000" x="12" y="2" width="8" height="1"/> <rect fill="#FFB000" x="10" y="3" width="12" height="1"/> <rect fill="#FFB000" x="9" y="4" width="14" height="1"/> <rect fill="#FFB000" x="8" y="5" width="16" height="1"/> <rect fill="#FFB000" x="7" y="6" width="18" height="1"/> <rect fill="#FFB000" x="6" y="7" width="20" height="1"/> <rect fill="#FFB000" x="5" y="8" width="22" height="2"/> <rect fill="#FFB000" x="4" y="10" width="24" height="7"/> <rect fill="#FFB000" x="5" y="17" width="22" height="2"/> <rect fill="#FFB000" x="6" y="19" width="20" height="1"/> <rect fill="#FFB000" x="7" y="20" width="18" height="1"/> <rect fill="#FFB000" x="8" y="21" width="16" height="1"/> <rect fill="#FFB000" x="9" y="22" width="14" height="1"/> <rect fill="#FFB000" x="10" y="23" width="12" height="1"/> <rect fill="#FFB000" x="12" y="24" width="8" height="2"/> <rect fill="#FFD400" x="13" y="3" width="6" height="1"/> <rect fill="#FFD400" x="11" y="4" width="10" height="1"/> <rect fill="#FFD400" x="10" y="5" width="12" height="1"/> <rect fill="#FFD400" x="9" y="6" width="14" height="1"/> <rect fill="#FFD400" x="8" y="7" width="16" height="1"/> <rect fill="#FFD400" x="7" y="8" width="18" height="2"/> <rect fill="#FFD400" x="6" y="10" width="20" height="7"/> <rect fill="#FFD400" x="7" y="17" width="18" height="2"/> <rect fill="#FFD400" x="8" y="19" width="16" height="1"/> <rect fill="#FFD400" x="9" y="20" width="14" height="1"/> <rect fill="#FFD400" x="10" y="21" width="12" height="1"/> <rect fill="#FFD400" x="11" y="22" width="10" height="1"/> <rect fill="#FFD400" x="12" y="23" width="8" height="1"/> <rect fill="#FFD400" x="13" y="24" width="6" height="2"/> <rect fill="#E88900" x="21" y="4" width="2" height="1"/> <rect fill="#E88900" x="22" y="5" width="1" height="2"/> <rect fill="#E88900" x="24" y="8" width="1" height="4"/> <rect fill="#E88900" x="25" y="10" width="1" height="4"/> <rect fill="#E88900" x="23" y="17" width="2" height="1"/> <rect fill="#E88900" x="22" y="19" width="2" height="1"/> <rect fill="#E88900" x="20" y="22" width="2" height="1"/> <rect fill="#E88900" x="18" y="24" width="2" height="2"/> <rect fill="#E88900" x="7" y="8" width="1" height="2"/> <rect fill="#E88900" x="6" y="17" width="1" height="1"/> <rect fill="#E88900" x="8" y="20" width="1" height="1"/> <rect fill="#E88900" x="10" y="23" width="1" height="1"/> <rect fill="#FFFFFF" x="13" y="4" width="2" height="1"/> <rect fill="#FFF8B8" x="12" y="5" width="1" height="2"/> <rect fill="#FFFFFF" x="11" y="7" width="2" height="1"/> <rect fill="#FFF8B8" x="10" y="8" width="1" height="1"/> <rect fill="#FFF8B8" x="9" y="10" width="1" height="2"/> <rect class="f-anim" x="13" y="12" width="2" height="1"/> <rect class="f-anim" x="18" y="12" width="2" height="1"/> <rect class="f-anim" x="13" y="13" width="1" height="3"/> <rect class="f-anim" x="19" y="13" width="1" height="3"/> <rect class="fg-anim" x="14" y="14" width="1" height="2"/> <rect class="fg-anim" x="18" y="14" width="1" height="2"/> <rect class="f-anim" x="15" y="15" width="3" height="1"/> <rect class="fg-anim" x="15" y="16" width="1" height="2"/> <rect class="fg-anim" x="17" y="16" width="1" height="2"/> <rect class="f-anim" x="16" y="18" width="1" height="7"/> <rect fill="#2E2E2E" x="11" y="25" width="10" height="1"/> <rect fill="#2E2E2E" x="12" y="26" width="1" height="1"/> <rect fill="#9B9B9B" x="13" y="26" width="2" height="1"/> <rect fill="#D7D7D7" x="15" y="26" width="4" height="1"/> <rect fill="#2E2E2E" x="19" y="26" width="1" height="1"/> <rect fill="#2E2E2E" x="11" y="27" width="1" height="1"/> <rect fill="#9B9B9B" x="12" y="27" width="3" height="1"/> <rect fill="#D7D7D7" x="15" y="27" width="4" height="1"/> <rect fill="#666666" x="19" y="27" width="1" height="1"/> <rect fill="#2E2E2E" x="20" y="27" width="1" height="1"/> <rect fill="#2E2E2E" x="12" y="28" width="1" height="1"/> <rect fill="#9B9B9B" x="13" y="28" width="2" height="1"/> <rect fill="#D7D7D7" x="15" y="28" width="4" height="1"/> <rect fill="#2E2E2E" x="19" y="28" width="1" height="1"/> <rect fill="#2E2E2E" x="11" y="29" width="1" height="1"/> <rect fill="#9B9B9B" x="12" y="29" width="3" height="1"/> <rect fill="#D7D7D7" x="15" y="29" width="4" height="1"/> <rect fill="#666666" x="19" y="29" width="1" height="1"/> <rect fill="#2E2E2E" x="20" y="29" width="1" height="1"/> <rect fill="#2E2E2E" x="12" y="30" width="1" height="1"/> <rect fill="#9B9B9B" x="13" y="30" width="2" height="1"/> <rect fill="#D7D7D7" x="15" y="30" width="4" height="1"/> <rect fill="#2E2E2E" x="19" y="30" width="1" height="1"/> <rect fill="#2E2E2E" x="13" y="31" width="6" height="1"/> <rect fill="#2E2E2E" x="14" y="32" width="4" height="1"/> </g> <g class="rays" fill="#FFFFFF"> <rect x="13" y="-5" width="1" height="1"/> <rect x="13" y="-4" width="1" height="1"/> <rect x="13" y="4" width="1" height="1"/> <rect x="13" y="5" width="1" height="1"/> <rect x="6" y="0" width="1" height="1"/> <rect x="7" y="0" width="1" height="1"/> <rect x="19" y="0" width="1" height="1"/> <rect x="20" y="0" width="1" height="1"/> <rect x="9" y="-3" width="1" height="1"/> <rect x="17" y="-3" width="1" height="1"/> <rect x="9" y="3" width="1" height="1"/> <rect x="17" y="3" width="1" height="1"/> </g> </g> <g class="body-breathe"> <g class="body-tilt"> <g class="arm-r" fill="#DE886D"> <rect x="13" y="9" width="2" height="2"/> </g> </g> </g> </g> </svg>`;
const CLAW_LONG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 40 40" width="500" height="500"> <defs> <style> /* Slow, rhythmic deep breathing animation */ .breathe { transform-origin: 7.5px 15px; /* Pivot at the floor to expand upwards */ animation: breathe-squash 4.5s infinite ease-in-out; } /* Shadow expands slightly as the body inflates */ .shadow-breathe { transform-origin: 7.5px 15.5px; animation: shadow-pulse 4.5s infinite ease-in-out; } /* Zzz Particle Base Styles */ .z-particle { opacity: 0; } .z1 { animation: float-1 6s infinite ease-in-out; animation-delay: 0s; } .z2 { animation: float-2 6s infinite ease-in-out; animation-delay: 2s; } .z3 { animation: float-3 6s infinite ease-in-out; animation-delay: 4s; } /* Breathing Keyframes (Slow inhale, hold, exhale, pause) */ @keyframes breathe-squash { 0%, 80%, 100% { transform: scale(1, 1); } 30%, 40% { transform: scale(1.02, 1.25); } /* Chest expands/inflates */ } @keyframes shadow-pulse { 0%, 80%, 100% { transform: scaleX(1); opacity: 0.4; } 30%, 40% { transform: scaleX(1.05); opacity: 0.5; } } /* Swaying and fading floating Z keyframes (Adjusted for lowered head) */ @keyframes float-1 { 0% { transform: translate(5px, 8px) scale(0.4); opacity: 0; } 10% { opacity: 1; } 30% { transform: translate(9px, 4px) scale(0.6); } 50% { transform: translate(4px, 0px) scale(0.8); } 70% { transform: translate(8px, -4px) scale(1.0); } 90% { opacity: 0.8; } 100% { transform: translate(6px, -8px) scale(1.1); opacity: 0; } } @keyframes float-2 { 0% { transform: translate(8px, 9px) scale(0.3); opacity: 0; } 10% { opacity: 1; } 30% { transform: translate(5px, 5px) scale(0.5); } 50% { transform: translate(9px, 1px) scale(0.7); } 70% { transform: translate(6px, -3px) scale(0.9); } 90% { opacity: 0.8; } 100% { transform: translate(8px, -7px) scale(1.0); opacity: 0; } } @keyframes float-3 { 0% { transform: translate(6px, 7px) scale(0.5); opacity: 0; } 10% { opacity: 1; } 30% { transform: translate(9px, 3px) scale(0.7); } 50% { transform: translate(4px, -1px) scale(0.9); } 70% { transform: translate(8px, -5px) scale(1.1); } 90% { opacity: 0.8; } 100% { transform: translate(5px, -9px) scale(1.2); opacity: 0; } } </style> <!-- Pixel Art "Z" Definitions --> <g id="pixel-z"> <rect x="0" y="0" width="4" height="1" /> <rect x="2" y="1" width="1" height="1" /> <rect x="1" y="2" width="1" height="1" /> <rect x="0" y="3" width="4" height="1" /> </g> <g id="pixel-z-small"> <rect x="0" y="0" width="3" height="1" /> <rect x="1" y="1" width="1" height="1" /> <rect x="0" y="2" width="3" height="1" /> </g> </defs> <!-- Ground Shadow (Widened for the splooted posture) --> <rect id="ground-shadow" class="shadow-breathe" x="-1" y="15" width="17" height="1" fill="#000000" /> <!-- Floating Zzz Bubbles --> <g class="zzz-particles"> <use href="#pixel-z" class="z-particle z1" fill="#90A4AE" /> <use href="#pixel-z-small" class="z-particle z2" fill="#B0BEC5" /> <use href="#pixel-z" class="z-particle z3" fill="#CFD8DC" /> </g> <!-- Splooted / Melted Sleeping Pose --> <g class="breathe"> <!-- Legs pointing up from behind (Relaxed Sploot) --> <g fill="#DE886D"> <rect id="outer-left-leg-up" x="3" y="9" width="1" height="1"/> <rect id="inner-left-leg-up" x="5" y="9" width="1" height="1"/> <rect id="inner-right-leg-up" x="9" y="9" width="1" height="1"/> <rect id="outer-right-leg-up" x="11" y="9" width="1" height="1"/> </g> <!-- Squashed Body Resting on the Floor --> <g fill="#DE886D"> <!-- Main flattened torso --> <rect id="torso-sploot" x="1" y="10" width="13" height="5"/> <!-- Arms spread flat on the ground --> <rect id="left-arm-sploot" x="-1" y="13" width="2" height="2"/> <rect id="right-arm-sploot" x="14" y="13" width="2" height="2"/> </g> <!-- Ultra-Thin Shut Eyes (Dashes) --> <g fill="#000000"> <rect id="left-eye-shut" x="3.5" y="12.5" width="2" height="0.4"/> <rect id="right-eye-shut" x="9.5" y="12.5" width="2" height="0.4"/> </g> </g> </svg>`;
const CLAW_DRAG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45" width="500" height="500"> <defs> <style> .body-anim { animation: body-bob 1s infinite linear; } .leg-a { animation: leg-a 1s infinite linear; } .leg-b { animation: leg-b 1s infinite linear; } .arm-l { animation: arm-l 1s infinite linear; } .arm-r { animation: arm-r 1s infinite linear; } .eyes-anim { transform-origin: 7.5px 9px; animation: eyes-look-blink 4s infinite linear; } @keyframes body-bob { 0%, 100% { transform: translate(0px, 1px); } 25% { transform: translate(0px, 0px); } 50% { transform: translate(0px, 1px); } 75% { transform: translate(0px, 0px); } } @keyframes leg-a { 0%, 100% { transform: translate(-2px, 0px); } 25% { transform: translate(0px, 0px); } 50% { transform: translate(2px, 0px); } 75% { transform: translate(0px, -2px); } } @keyframes leg-b { 0%, 100% { transform: translate(2px, 0px); } 25% { transform: translate(0px, -2px); } 50% { transform: translate(-2px, 0px); } 75% { transform: translate(0px, 0px); } } @keyframes arm-l { 0%, 50%, 100% { transform: translate(0px, 0px); } 25% { transform: translate(0px, -1px); } 75% { transform: translate(0px, 1px); } } @keyframes arm-r { 0%, 50%, 100% { transform: translate(0px, 0px); } 25% { transform: translate(0px, 1px); } 75% { transform: translate(0px, -1px); } } @keyframes eyes-look-blink { 0%, 48%, 52%, 100% { transform: translate(-2px, 0px) scaleY(1); } 50% { transform: translate(-2px, 0px) scaleY(0.1); } } </style> </defs> <!-- Ground Shadow --> <rect id="ground-shadow" x="3" y="15" width="9" height="1" fill="#000000" opacity="0.5"/> <!-- Animated Legs --> <g id="legs" fill="#DE886D"> <g class="leg-a"> <rect id="outer-left-leg" x="3" y="13" width="1" height="2"/> </g> <g class="leg-b"> <rect id="inner-left-leg" x="5" y="13" width="1" height="2"/> </g> <g class="leg-a"> <rect id="inner-right-leg" x="9" y="13" width="1" height="2"/> </g> <g class="leg-b"> <rect id="outer-right-leg" x="11" y="13" width="1" height="2"/> </g> </g> <!-- Animated Upper Body --> <g class="body-anim"> <!-- Body Color Group --> <g fill="#DE886D"> <rect id="torso" x="2" y="6" width="11" height="7"/> <g class="arm-l"> <rect id="left-arm" x="0" y="9" width="2" height="2"/> </g> <g class="arm-r"> <rect id="right-arm" x="13" y="9" width="2" height="2"/> </g> </g> <!-- Eyes Color Group --> <g class="eyes-anim" fill="#000000"> <rect id="left-eye" x="4" y="8" width="1" height="2"/> <rect id="right-eye" x="10" y="8" width="1" height="2"/> </g> </g> </svg>`;
const CLAW_ANIM: Record<string,string> = { idle: CLAW_IDLE, tap: CLAW_TAP, long: CLAW_LONG, drag: CLAW_DRAG };

interface AndroidBridge2 { getBubbleConfig?:()=>string; setBubbleConfig?:(s:string)=>void; }
function getAndroid2(): AndroidBridge2|null{
  try{return (window as unknown as {Android?:AndroidBridge2}).Android ?? null;}catch{return null;}
}
function loadState(): BubbleCfg{
  try{
    const a=getAndroid2();
    if(a?.getBubbleConfig){
      const raw=a.getBubbleConfig();
      if(raw){ const p=JSON.parse(raw) as BubbleCfg; if(p?.icon && p?.color && p?.size) return {icon:p.icon as IconId, color:p.color, size:p.size, x:p.x??null, y:p.y??null};}
    }
  }catch{}
  try{
    const ls=localStorage.getItem("mock_bubble");
    if(ls){ const p=JSON.parse(ls) as BubbleCfg; if(p?.icon && p?.color && p?.size) return {icon:p.icon as IconId, color:p.color, size:p.size, x:p.x??null, y:p.y??null};}
  }catch{}
  return {...DEFAULT};
}
function persist(s:BubbleCfg){
  try{localStorage.setItem("mock_bubble",JSON.stringify(s));}catch{}
  try{getAndroid2()?.setBubbleConfig?.(JSON.stringify(s));}catch{}
}

export default function BubbleDesignPage(){
  const navigate=useNavigate();
  const showToast=useToast();
  const [state,setState]=useState<BubbleCfg>(()=>loadState());
  const [customOpen,setCustomOpen]=useState(false);
  const [cpText,setCpText]=useState(state.color);
  const bubbleRef=useRef<HTMLDivElement>(null);
  const [anim,setAnim]=useState("idle");
  const revertRef=useRef<number|null>(null);
  const longRef=useRef<number|null>(null);
  const dragRef=useRef({dragging:false,moved:false,longFired:false,sx:0,sy:0,ox:0,oy:0,pid:0 as unknown as number});
  const LONG_MS=500;

  useEffect(()=>{ setCpText(state.color); },[state.color]);
  useEffect(()=>{ setAnim("idle"); if(revertRef.current) clearTimeout(revertRef.current); if(longRef.current) clearTimeout(longRef.current); },[state.icon]);

  const showAnim=(name:string, revertMs?:number)=>{
    if(state.icon!=="claudeCode") return;
    const map: Record<string,number> = {tap:1600,long:2000,drag:600};
    const ms = revertMs ?? map[name];
    setAnim(name);
    if(revertRef.current) clearTimeout(revertRef.current);
    if(ms && name!=="idle") revertRef.current = window.setTimeout(()=>setAnim("idle"), ms) as unknown as number;
  };

  const update=(patch:Partial<BubbleCfg>)=>{
    setState(prev=>{ const next={...prev,...patch}; persist(next); return next; });
  };

  useEffect(()=>{
    const el=bubbleRef.current;
    if(!el) return;
    const onDown=(e:PointerEvent)=>{
      try{ (el as HTMLElement).setPointerCapture(e.pointerId); }catch{}
      const r=el.getBoundingClientRect();
      dragRef.current={dragging:true,moved:false,longFired:false,sx:e.clientX,sy:e.clientY,ox:r.left,oy:r.top,pid:e.pointerId};
      el.classList.add("dragging");
      if(longRef.current) clearTimeout(longRef.current);
      longRef.current = window.setTimeout(()=>{
        if(!dragRef.current.moved && !dragRef.current.dragging){}
        if(!dragRef.current.moved){ dragRef.current.longFired=true; showAnim("long",2000); }
      }, LONG_MS) as unknown as number;
    };
    const onMove=(e:PointerEvent)=>{
      if(!dragRef.current.dragging) return;
      if(e.pointerId!==dragRef.current.pid) return;
      const dx=e.clientX - dragRef.current.sx, dy=e.clientY - dragRef.current.sy;
      if(!dragRef.current.moved && (Math.abs(dx)>8 || Math.abs(dy)>8)){
        if(longRef.current){ clearTimeout(longRef.current); longRef.current=null; }
        dragRef.current.moved=true;
        showAnim("drag");
      }
      if(dragRef.current.moved){
        const nx=Math.max(4,Math.min(window.innerWidth - el.offsetWidth -4, dragRef.current.ox+dx));
        const ny=Math.max(4,Math.min(window.innerHeight - el.offsetHeight -4, dragRef.current.oy+dy));
        el.style.left=nx+"px"; el.style.top=ny+"px"; el.style.right="auto"; el.style.bottom="auto";
      }
    };
    const onUp=(e:PointerEvent)=>{
      if(!dragRef.current.dragging) return;
      if(e.pointerId!==dragRef.current.pid && dragRef.current.pid!==0) return;
      if(longRef.current){ clearTimeout(longRef.current); longRef.current=null; }
      try{ (el as HTMLElement).releasePointerCapture(e.pointerId); }catch{}
      el.classList.remove("dragging");
      if(!dragRef.current.moved && !dragRef.current.longFired){
        showAnim("tap",1600);
      } else if(dragRef.current.moved){
        const r=el.getBoundingClientRect();
        const nx=Math.round(r.left), ny=Math.round(r.top);
        setState(prev=>{ const next={...prev,x:nx,y:ny}; persist(next); return next; });
        window.setTimeout(()=>setAnim("idle"),600);
      }
      dragRef.current.dragging=false;
    };
    const onCancel=()=>{
      if(longRef.current){ clearTimeout(longRef.current); longRef.current=null; }
      dragRef.current.dragging=false; dragRef.current.moved=false; dragRef.current.longFired=false;
      el.classList.remove("dragging");
      setAnim("idle");
    };
    el.addEventListener("pointerdown",onDown);
    window.addEventListener("pointermove",onMove);
    window.addEventListener("pointerup",onUp);
    el.addEventListener("pointercancel",onCancel as any);
    return()=>{ el.removeEventListener("pointerdown",onDown); window.removeEventListener("pointermove",onMove); window.removeEventListener("pointerup",onUp); el.removeEventListener("pointercancel",onCancel as any); if(longRef.current) clearTimeout(longRef.current); if(revertRef.current) clearTimeout(revertRef.current); };
  },[state.icon]);

  const bubbleInner = state.icon==="claudeCode" ? (CLAW_ANIM[anim] ?? CLAW_IDLE) : (ICONS[state.icon] ?? ICON_CLAUDE);
  const bubbleTip = state.icon==="claudeCode" ? "tap = eureka • hold = sleep • drag = walk" : "drag me";
  const bubbleStyle: React.CSSProperties = state.x!=null && state.y!=null
    ? { left: state.x, top: state.y, right:"auto", bottom:"auto" }
    : { left:"auto", top:88, right:16, bottom:"auto" };

  const applyCustom=()=>{
    let v=cpText.trim().toLowerCase();
    if(!v.startsWith("#")) v="#"+v;
    if(/^#[0-9a-f]{6}$/.test(v)){ update({color:v}); }
    setCustomOpen(false);
  };

  return (
    <>
      <style>{`
        .bd-wrap{max-width:100%;margin:0 auto;padding:12px 12px 90px;background:var(--bg,#f8fafc);min-height:calc(100dvh - 56px);overflow-y:auto}
        .bd-top{position:sticky;top:0;z-index:5;background:rgba(248,250,252,.96);backdrop-filter:blur(8px);display:flex;align-items:center;gap:10px;padding:10px 0 10px;margin:0 -12px 8px;border-bottom:1px solid var(--border,#e2e8f0);padding-left:12px;padding-right:12px}
        .bd-back{width:34px;height:34px;border-radius:999px;border:1px solid var(--border,#e2e8f0);background:#fff;display:grid;place-items:center;cursor:pointer;font-size:20px;line-height:1}
        .bd-card{background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:12px;margin-top:10px}
        .bd-card h3{margin:0;font-size:13px;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
        .bd-card h3 i{width:24px;height:24px;border-radius:7px;background:#f1f5f9;display:grid;place-items:center;font-style:normal;font-size:13px}
        .bd-iconOpt{width:48px;height:48px;border-radius:12px;border:2px solid var(--border,#e2e8f0);display:grid;place-items:center;cursor:pointer;background:#fff;transition:.15s;flex-shrink:0}
        .bd-iconOpt.on{border-color:#0f172a}
        .bd-sw{width:20px;height:30px;border-radius:5px;border:2px solid transparent;cursor:pointer;flex-shrink:0}
        .bd-sw.on{border-color:#0f172a}
        .bd-range{width:100%;accent-color:#0f172a}
        .bd-foot{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);border-top:1px solid var(--border,#e2e8f0);padding:10px 14px;display:flex;gap:10px;max-width:640px;margin:0 auto;z-index:30}
        .bd-btn{flex:1;padding:12px;border-radius:12px;border:1px solid var(--border,#e2e8f0);background:#fff;font-weight:700;font-size:13px;cursor:pointer}
        .bd-btnPrimary{background:#0f172a;color:#fff;border-color:#0f172a}
        .bd-bubble{position:fixed;z-index:40;touch-action:none;user-select:none;display:grid;place-items:center;filter:none;cursor:grab;background:transparent}
        .bd-bubble:active{cursor:grabbing}
        .bd-bubble .tip{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);background:#0f172a;color:#fff;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 8px;border-radius:999px;white-space:nowrap;pointer-events:none;opacity:0;transition:.2s}
        .bd-bubble.dragging .tip{opacity:1}
        .bd-bubble svg{width:100%;height:100%;display:block}
      `}</style>
      <div className="bd-wrap">
        <div className="bd-top">
          <button className="bd-back" aria-label="Back" onClick={()=>{ if(window.history.length>1) navigate(-1); else navigate("/"); }}>&#8249;</button>
          <b style={{fontSize:15,letterSpacing:"-.02em"}}>Sheet Submit</b>
          <span style={{marginLeft:"auto",fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#64748b",background:"#fff",border:"1px solid var(--border,#e2e8f0)",padding:"4px 8px",borderRadius:999}}>Bubble design</span>
        </div>
        <h1 style={{margin:"10px 0 2px",fontSize:18,letterSpacing:"-.02em"}}>Bubble design</h1>

        <div className="bd-card">
          <h3><i>⬢</i> Icon</h3>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
            {([
              {id:"logo" as IconId},{id:"claude" as IconId},{id:"claudeCode" as IconId},{id:"pacman" as IconId},
            ]).map(m=>(
              <button key={m.id} className={`bd-iconOpt${state.icon===m.id?" on":""}`} aria-label={m.id} onClick={()=>update({icon:m.id})}>
                <div style={{width:28,height:28,color:state.color,display:"grid",placeItems:"center"}} dangerouslySetInnerHTML={{__html: m.id==="claudeCode" ? CLAW_IDLE : (ICONS[m.id] ?? ICON_CLAUDE)}} />
              </button>
            ))}
          </div>
        </div>

        <div className="bd-card">
          <h3><i>◉</i> Color</h3>
          <div style={{display:"flex",gap:1,flexWrap:"nowrap",overflowX:"auto",overflowY:"hidden",marginTop:10,paddingBottom:4,scrollbarWidth:"none"}}>
            <button className="bd-sw" aria-label="Custom" title="Custom" onClick={()=>{ setCustomOpen(o=>!o); setCpText(state.color); }} style={{width:20,height:30,padding:0,display:"grid",placeItems:"center",background:"#fff",border:"1px solid var(--border,#e2e8f0)",borderRadius:5,flexShrink:0}}>
              <span style={{width:10,height:10,borderRadius:3,background:"conic-gradient(from 0deg,#ef4444,#f59e0b,#22c55e,#06b6d4,#8b5cf6,#ef4444)",border:"1px solid rgba(0,0,0,.15)",display:"block"}}/>
            </button>
            {COLORS.map(c=>(
              <button key={c} className={`bd-sw${c.toLowerCase()===state.color.toLowerCase()?" on":""}`} aria-label={c} title={c} onClick={()=>update({color:c.toLowerCase()})} style={{background:c,borderColor:c.toLowerCase()==="#ffffff"?"var(--border,#e2e8f0)":undefined}} />
            ))}
          </div>
          {customOpen && (
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10}}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(cpText) ? cpText.toLowerCase() : state.color} onChange={e=>{ const v=e.target.value.toLowerCase(); setCpText(v); update({color:v}); }} style={{width:40,height:36,padding:3,border:"1px solid var(--border,#e2e8f0)",borderRadius:8,background:"#fff"}}/>
              <input type="text" value={cpText} maxLength={7} spellCheck={false} onChange={e=>{ let v=e.target.value.trim(); if(!v.startsWith("#")) v="#"+v; v=v.toLowerCase(); setCpText(e.target.value); if(/^#[0-9a-f]{6}$/.test(v)){ update({color:v}); } if(/^#[0-9a-f]{6}$/i.test(v)) setCpText(v); }} style={{flex:1,padding:"8px 10px",border:"1px solid var(--border,#e2e8f0)",borderRadius:8,fontSize:13,fontFamily:"ui-monospace,monospace"}}/>
              <button className="bd-btn bd-btnPrimary" style={{padding:"8px 14px",flex:"0 0 auto"}} onClick={applyCustom}>Use</button>
            </div>
          )}
        </div>

        <div className="bd-card">
          <h3><i>↔</i> Size</h3>
          <div style={{marginTop:12}}>
            <input type="range" className="bd-range" min={36} max={84} step={2} value={state.size} onChange={e=>update({size:+e.target.value})}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#64748b",marginTop:4}}><span>Small</span><b style={{color:"#0f172a",fontSize:12,fontFamily:"ui-monospace,monospace"}}>{state.size} dp</b><span>Large</span></div>
          </div>
        </div>
      </div>

      <div ref={bubbleRef} className="bd-bubble" aria-label="Floating bubble preview (demo only)" title={state.icon==="claudeCode" ? "Tap / hold / drag — animated" : undefined} style={{width:state.size,height:state.size,color:state.color,...bubbleStyle}}>
        <div key={state.icon==="claudeCode"?anim:state.icon} style={{width:"100%",height:"100%",color:state.color}} dangerouslySetInnerHTML={{__html:bubbleInner}} />
        <span className="tip">{bubbleTip}</span>
      </div>

      <div className="bd-foot">
        <button className="bd-btn" onClick={()=>{ const n={...DEFAULT}; setState(n); persist(n); showToast("Reset to default"); }}>Reset</button>
        <button className="bd-btn bd-btnPrimary" onClick={()=>{ persist(state); showToast(`Saved — bubble_icon=${state.icon} bubble_color=${state.color} bubble_size=${state.size}`); }}>Save</button>
      </div>
    </>
  );
}
