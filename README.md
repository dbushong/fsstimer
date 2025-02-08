# FSS Timer

Floating Sheep Studios presents... a kitchen timer.

Modeled after the ambitious but fatally flawed
[ThermoWorks TimeStack](https://www.thermoworks.com/timestack/), this is
a Progressive Web App for a powerful, flexible, multiple kitchen timer.

The idea is to use it on a spare tablet/phone, and have a more powerful
timer for a lower cost.

[See it in action](https://www.youtube.com/shorts/j5Ni3_5drxo) on a
$36 Android tablet, or [try it live](https://dbushong.github.io/fsstimer/).

## Features

- Four HH:MM:SS timers, supporting up to 99:99:99
- Countdown or Count up
- Configurable labels
- Speech synthesis label announcement when the alarm goes off
- Speech recognition for label & duration entry
- Free

## Installation

1. Go to https://dbushong.github.io/fsstimer/
2. Choose "Add to Home Screen" from a menu on your browser
3. Find the new icon and launch the "app" from there

You might wish to do some other changes, if you're dedicating a device to
use as a timer:

- Turn up the delay before screen sleep (30 minutes?)
- Give the app permission to use the microphone
- Disable the screen lock entirely (no swiping up or anything to return to
  app)
- Put the app icon front and center on the home screen
- Install an app like Tasker and configure it to launch the timer on startup

## Bugs

- Occasionally 

## TODO

- Add a Service Worker so the app will work properly offline
- Nicer icons/CSS

## Development

1. Clone this repo
2. `npm install` to install the TypeScript compiler
3. `make watch` to start the compiler
4. Edit `timer.ts` and `index.html`

## Credits

- [TypeScript](https://www.typescriptlang.org/)
- [MDN](https://developer.mozilla.org/en-US/docs/Web)
- [DSEG Font](https://www.keshikan.net/fonts-e.html)
