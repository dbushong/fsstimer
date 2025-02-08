"use strict";
/**
 * 4-entry kitchen timer, intended for use on a tablet
 *
 * Things a timer remembers (in localStorage):
 *
 * - its name
 * - what duration was originally set to
 * - what duration was left last time it was started
 * - when it was started
 * - when it was stopped
 *
 * Then the displayed time for a timer is durationAtStart - (stop || now) + start
 *
 * TODO:
 *
 * - After 60s of beeping, beep once every 60s
 * - Setup service worker for offline use
 * - Split into separate files(?)
 */
let audioCtx;
let setting = -1; // whether we're setting a timer currently (and which)
let state;
const settingDigits = []; // what digits have been entered so far
const alarmIntervals = [0, 0, 0, 0]; // for any alarms going off
const SPEECH_RECOGNITION = 'webkitSpeechRecognition';
let wakeLock = null;
let setRecog = null;
// seconds since epoch (rounded)
function nowSeconds(nowMs = Date.now()) {
    return Math.round(nowMs / 1000);
}
function running(timer) {
    return !!timer.start && !timer.stop;
}
function $(selector, klass = HTMLElement, parent) {
    const elm = (parent || document).querySelector(selector);
    if (!elm)
        throw new Error(`Missing element ${selector}`);
    if (!(elm instanceof klass)) {
        throw new Error(`Element ${selector} is not a ${klass}`);
    }
    return elm;
}
function $$(selector, klass = HTMLElement, parent) {
    const elms = (parent || document).querySelectorAll(selector);
    if (!elms.length)
        throw new Error(`No elements matching ${selector}`);
    return [...elms].map((elm) => {
        if (!(elm instanceof klass)) {
            throw new Error(`Element of ${selector} is not a ${klass}`);
        }
        return elm;
    });
}
function beep(vol, freq, duration, delay = 0) {
    if (!audioCtx)
        audioCtx = new AudioContext();
    const v = audioCtx.createOscillator();
    const u = audioCtx.createGain();
    v.connect(u);
    v.frequency.value = freq;
    v.type = 'square';
    u.connect(audioCtx.destination);
    u.gain.value = vol * 0.01;
    v.start(audioCtx.currentTime + delay * 0.001);
    v.stop(audioCtx.currentTime + (delay + duration) * 0.001);
}
// subtract seconds from h/m/s duration, allowing h, m, and s to
// all be any value 0-99 and subtracting seconds first, but then reverting
// to 59 for minutes and seconds after dropping to 0 for either
// e.g.:
// 99/99/99 -  20 = 99/99/79
//          - 101 = 99/98/58
function addDuration(dur, secs) {
    let s = dur.h * 3600 + dur.m * 60 + dur.s + secs;
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    return { ...dur, h, m, s };
}
function subtractDuration(dur, secs) {
    if (dur.neg)
        return addDuration(dur, secs);
    let h = dur.h;
    let m = dur.m;
    let s = dur.s;
    for (let left = secs; left > 0; left--) {
        if (!s) {
            if (!m) {
                if (!h)
                    return addDuration({ ...dur, h, m, s, neg: true }, left);
                h--;
                m = 60;
            }
            m--;
            s = 60;
        }
        s--;
    }
    return { ...dur, h, m, s };
}
function hmsToStr(h, m, s) {
    return [
        h.toString().padStart(2, '0'),
        m.toString().padStart(2, '0'),
        s.toString().padStart(2, '0'),
    ].join(':');
}
function remainingTime(t, now = nowSeconds()) {
    let duration = t.duration;
    if (t.start) {
        duration = subtractDuration(t.durationAtStart, (t.stop || now) - t.start);
    }
    // the DSEG7 font displays ! as as full width empty segment display
    const neg = duration.neg && !duration.countUp;
    return [neg, hmsToStr(duration.h, duration.m, duration.s)];
}
function getTimerElm(timerNum) {
    return $(`#timer-${timerNum}`);
}
function getTimeElm(timerNum) {
    return $('.time', HTMLElement, getTimerElm(timerNum));
}
function getTimeBoxElm(timerNum) {
    return $('.time-box', HTMLElement, getTimerElm(timerNum));
}
function saveState() {
    const json = JSON.stringify(state);
    window.localStorage.timerState = json;
    const runningTimers = state.timers.some((t) => running(t) && !t.durationAtStart.countUp && !t.durationAtStart.neg);
    if (runningTimers && !wakeLock) {
        navigator.wakeLock.request().then((s) => {
            wakeLock = s;
        }, console.error);
    }
    else if (!runningTimers && wakeLock) {
        wakeLock.release().catch(console.error);
        wakeLock = null;
    }
}
function saveNewTime(timerNum, setOrig = true) {
    // set the timer state to whatever the HTML currently says
    const timeElm = getTimeElm(timerNum);
    const neg = getTimeBoxElm(timerNum).classList.contains('neg');
    const match = timeElm.innerHTML.match(/^(?<h>\d\d)[: ](?<m>\d\d)[: ](?<s>\d\d)$/);
    if (!match)
        throw new Error(`invalid elapsed time ${timeElm}.innerHTML`);
    const timer = state.timers[timerNum];
    const h = Math.min(parseInt(match.groups.h, 10), 99);
    const m = parseInt(match.groups.m, 10);
    const s = parseInt(match.groups.s, 10);
    const countUp = (!setOrig && timer.duration.countUp) || !(h || m || s);
    timer.durationAtStart = { countUp, neg: countUp || neg, h, m, s };
    if (setOrig)
        timer.duration = { ...timer.durationAtStart };
    saveState();
    setting = -1;
    settingDigits.splice(0);
    timeElm.classList.remove('blinking');
}
function setTime(timerNum, [neg, time]) {
    const timerElm = getTimerElm(timerNum);
    const timeElm = $('.time', HTMLElement, timerElm);
    const timeBoxElm = $('.time-box', HTMLElement, timerElm);
    timeElm.innerHTML = time;
    timeBoxElm.classList.toggle('neg', neg);
}
function setClicked(timerNum) {
    const timeElm = getTimeElm(timerNum);
    const timer = state.timers[timerNum];
    if (setting > -1) {
        if (setRecog) {
            setRecog.stop();
            setRecog = null;
        }
        // if we're currently setting a time...
        const oldSetting = setting;
        saveNewTime(setting);
        if (oldSetting === timerNum)
            return; // if was us, then was just confirming
    }
    setting = timerNum;
    timer.start = 0;
    setTime(timerNum, remainingTime(timer));
    timeElm.classList.add('blinking');
    if (SPEECH_RECOGNITION in window) {
        setRecog = new window[SPEECH_RECOGNITION]();
        setRecog.addEventListener('result', (ev) => {
            setRecog = null;
            let input = ev.results[0][0].transcript;
            if (input === 'reset')
                input = `0 seconds for Timer ${timerNum + 1}`;
            const m = input &&
                input.match(/^(?:(?<hrs>(?:\d+|one))\s+hours?(?:\s+and)?\s*)?(?:(?<mins>(?:\d+|one))\s+minutes?(?:\s+and)?\s*)?(?:(?<secs>(?:\d+|one))\s+seconds?\s*)?(?:timer\s*)?(?:for\s+(?<newName>.+))?$/i);
            const g = m && m.groups;
            if (!g || !(g.hrs || g.mins || g.secs)) {
                alert(`Failed to parse voice input: ${JSON.stringify(input)}`);
                return;
            }
            if (g.newName) {
                const newName = g.newName.replace(/\b[a-z]/g, (c) => c.toUpperCase());
                $('.timer-name', HTMLInputElement, getTimerElm(timerNum)).value =
                    state.timers[timerNum].name = newName;
                if (!isDefaultName(newName))
                    preloadSynth();
            }
            function parse(s) {
                if (s === 'one')
                    return 1;
                return s ? parseInt(s, 10) : 0;
            }
            const hrs = parse(g.hrs);
            const mins = parse(g.mins);
            const secs = parse(g.secs);
            if (hrs > 99 || mins > 99 || secs > 99) {
                alert(`Time segments must each be less than 100; got ${JSON.stringify(input)}`);
                return;
            }
            timeElm.innerHTML = hmsToStr(hrs, mins, secs);
            if (hrs || mins || secs)
                stopStartClicked(timerNum);
            else
                setClicked(timerNum);
        });
        setRecog.start();
    }
    // TODO: maybe mark the num buttons as disabled/not based on setting mode
}
function stopStartClicked(timerNum) {
    beep(30, 120, 15);
    // if we were setting a timer, pretend we hit "set" to confirm it first
    if (setting > -1)
        setClicked(setting);
    const timer = state.timers[timerNum];
    const timerElm = getTimerElm(timerNum);
    const timeElm = getTimeElm(timerNum);
    const timeBoxElm = getTimeBoxElm(timerNum);
    saveNewTime(timerNum, false);
    if (running(timer)) {
        timer.stop = timer.start;
        clearInterval(alarmIntervals[timerNum]);
        alarmIntervals[timerNum] = 0;
        timeElm.innerHTML = timeElm.innerHTML.replace(/ /g, ':');
    }
    else if (finished(timeBoxElm.classList.contains('neg'), timeElm.innerHTML, timer) &&
        !isZeroDur(timer.duration)) {
        // if we've hit Start on a stopped-but-finished timer, reset it to the orig
        timer.start = 0;
        setTime(timerNum, remainingTime(timer));
        saveNewTime(timerNum);
    }
    else {
        if (isZeroDur(timer.duration)) {
            timer.duration.neg = timer.duration.countUp = true;
        }
        timer.start = nowSeconds();
        timer.stop = 0;
    }
    saveState();
    const setElm = $('.set', HTMLButtonElement, timerElm);
    setElm.disabled = running(timer);
}
function isZeroDur(dur) {
    return !(dur.h || dur.m || dur.s);
}
function numClicked(num) {
    beep(20, 150, 50);
    if (setting < 0 || settingDigits.length >= 6)
        return;
    settingDigits.push(num);
    const timeElm = getTimeElm(setting);
    const d = settingDigits;
    const l = d.length;
    timeElm.innerHTML = `${d[l - 6] || 0}${d[l - 5] || 0}:${d[l - 4] || 0}${d[l - 3] || 0}:${d[l - 2] || 0}${d[l - 1]}`;
}
const ZERO_DUR = { h: 0, m: 0, s: 0, neg: true, countUp: true };
const EMPTY_STATE = {
    version: 1,
    timers: [
        {
            name: 'Timer 1',
            duration: { ...ZERO_DUR },
            start: 0,
            stop: 0,
            durationAtStart: { ...ZERO_DUR },
        },
        {
            name: 'Timer 2',
            duration: { ...ZERO_DUR },
            start: 0,
            stop: 0,
            durationAtStart: { ...ZERO_DUR },
        },
        {
            name: 'Timer 3',
            duration: { ...ZERO_DUR },
            start: 0,
            stop: 0,
            durationAtStart: { ...ZERO_DUR },
        },
        {
            name: 'Timer 4',
            duration: { ...ZERO_DUR },
            start: 0,
            stop: 0,
            durationAtStart: { ...ZERO_DUR },
        },
    ],
};
function nameMicTap(timerNum) {
    const recog = new window[SPEECH_RECOGNITION]();
    recog.addEventListener('result', (ev) => {
        let newName = ev.results[0][0].transcript;
        if (newName === 'reset')
            newName = `Timer ${timerNum + 1}`;
        $('.timer-name', HTMLInputElement, getTimerElm(timerNum)).value =
            state.timers[timerNum].name = newName;
        saveState();
        if (!isDefaultName(newName))
            preloadSynth();
    });
    recog.start();
}
let synthLoaded = false;
// need to preload speech synth - else long delay
function preloadSynth() {
    if (synthLoaded)
        return;
    if ('speechSynthesis' in window)
        say('ready', 0);
    synthLoaded = true;
}
function run() {
    state = (JSON.parse(window.localStorage.timerState || 'null') ||
        EMPTY_STATE);
    const timersElm = document.getElementById('timers');
    if (!timersElm)
        throw new Error('missing #timers');
    state.timers.forEach((t, i) => {
        const timerElm = document.createElement('div');
        timerElm.className = 'timer';
        timerElm.id = `timer-${i}`;
        const nameRowElm = document.createElement('div');
        nameRowElm.className = 'timer-name-row';
        timerElm.appendChild(nameRowElm);
        if (SPEECH_RECOGNITION in window) {
            const micElm = document.createElement('button');
            micElm.innerHTML = '🎤';
            micElm.addEventListener('click', () => {
                nameMicTap(i);
            });
            nameRowElm.appendChild(micElm);
        }
        const nameElm = document.createElement('input');
        nameElm.className = 'timer-name';
        nameElm.value = t.name;
        if (!isDefaultName(t.name))
            preloadSynth();
        nameElm.addEventListener('change', function () {
            if (!this.value)
                this.value = `Timer ${i}`;
            t.name = this.value;
            saveState();
            if (!isDefaultName(t.name))
                preloadSynth();
        });
        nameRowElm.appendChild(nameElm);
        const uiElm = document.createElement('div');
        uiElm.className = 'timer-ui';
        const setElm = document.createElement('button');
        setElm.className = 'set';
        if (running(t))
            setElm.disabled = true;
        setElm.appendChild(document.createTextNode('Set'));
        setElm.addEventListener('click', () => setClicked(i));
        uiElm.appendChild(setElm);
        const timeBoxElm = document.createElement('div');
        timeBoxElm.className = 'time-box';
        uiElm.appendChild(timeBoxElm);
        const timeGhostElm = document.createElement('div');
        timeGhostElm.className = 'time-ghost';
        timeGhostElm.appendChild(document.createTextNode('88:88:88'));
        timeBoxElm.appendChild(timeGhostElm);
        const timeElm = document.createElement('div');
        timeElm.className = 'time';
        timeBoxElm.appendChild(timeElm);
        timeBoxElm.addEventListener('click', () => {
            stopStartClicked(i);
        });
        timerElm.appendChild(uiElm);
        timersElm.appendChild(timerElm);
        setTime(i, remainingTime(t));
    });
    for (const numElm of document.querySelectorAll('#num-buttons button')) {
        const num = parseInt(numElm.innerHTML, 10);
        numElm.addEventListener('pointerdown', () => {
            numClicked(num);
        });
    }
    $('#reset').addEventListener('click', () => {
        if (confirm('Are you sure?')) {
            state = EMPTY_STATE;
            saveState();
            location.reload();
        }
    });
    $('#reload').addEventListener('click', () => {
        location.reload();
    });
    const usageElm = $('#usage', HTMLDialogElement);
    $('#show-usage').addEventListener('click', () => {
        usageElm.showModal();
    });
    $('#close-usage').addEventListener('click', () => {
        usageElm.close();
    });
    tick();
}
function finished(neg, timeStr, timer, almost = false) {
    if (timer.duration.countUp)
        return false;
    if (neg)
        return true;
    const re = almost ? /^00[: ]00[: ]0[01]$/ : /^00[: ]00[: ]00$/;
    return re.test(timeStr);
}
function say(msg, volume = 1) {
    const utt = new SpeechSynthesisUtterance(msg);
    utt.volume = volume;
    speechSynthesis.speak(utt);
}
function isDefaultName(name) {
    return /^Timer \d+$/.test(name);
}
const BEEP_LEN = 200;
const BEEP_PAUSE = 25;
const BEEP_FREQ = 2115;
class TimerAlarm {
    timerNum;
    speakName = null;
    fires = 0;
    constructor(timerNum) {
        this.timerNum = timerNum;
        if ('speechSynthesis' in window) {
            const { name } = state.timers[timerNum];
            if (!isDefaultName(name))
                this.speakName = name;
        }
    }
    fire() {
        // after 60 beeps, only beep once a minute
        if (this.fires < 60 || !(this.fires % 60)) {
            if (this.speakName && this.fires % 2) {
                say(this.speakName); // if config'd, speak name every other "beep"
            }
            else {
                for (let i = 0; i <= this.timerNum; i++) {
                    beep(100, BEEP_FREQ, BEEP_LEN, i * (BEEP_PAUSE + BEEP_LEN));
                }
            }
        }
        this.fires++;
    }
}
function tick() {
    const nowMs = Date.now();
    const now = nowSeconds(nowMs);
    state.timers.forEach((t, i) => {
        if (!running(t))
            return;
        const [neg, newRemaining] = remainingTime(t, now);
        if (finished(neg, newRemaining, t, true) && !alarmIntervals[i]) {
            // TODO: support slower interval after a minute
            const timerAlarm = new TimerAlarm(i);
            alarmIntervals[i] = setInterval(timerAlarm.fire.bind(timerAlarm), 1000);
        }
        setTime(i, [neg, newRemaining]);
    });
    // schedule our next tick for the next rounded "second since now"
    const delay = (now + 1) * 1000 - nowMs;
    setTimeout(hideColons, Math.round(delay / 2));
    setTimeout(tick, delay);
}
function hideColons() {
    state.timers.forEach((t, i) => {
        if (running(t)) {
            const timeElm = getTimeElm(i);
            timeElm.innerHTML = timeElm.innerHTML.replace(/:/g, ' ');
        }
    });
}
document.addEventListener('DOMContentLoaded', run);
