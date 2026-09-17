// Everything you'd normally want to change lives in this file.

export const CONFIG = {
  handle: 'guruflabba',

  // Lines typed out under the title, one after another.
  taglines: [
    'LIVE STREAMS',
    'VIDEOS',
    'CLIPS',
    'TRANSMITTING FROM THE VOID',
    'BE KIND, REWIND',
  ],

  // Order here = order on the page.
  links: [
    { id: 'twitch',    label: 'TWITCH',    url: 'https://www.twitch.tv/guruflabba',    brand: '#9146ff', ink: '#ffffff' },
    { id: 'youtube',   label: 'YOUTUBE',   url: 'https://www.youtube.com/@guruflabba', brand: '#ff1f3d', ink: '#ffffff' },
    { id: 'tiktok',    label: 'TIKTOK',    url: 'https://www.tiktok.com/@guruflabba',  brand: '#25f4ee', ink: '#05040b' },
    { id: 'instagram', label: 'INSTAGRAM', url: 'https://www.instagram.com/guruflabba', brand: '#ff3d8b', ink: '#05040b' },
    { id: 'x',         label: 'X',         url: 'https://x.com/guruflabba',            brand: '#eef2dd', ink: '#05040b' },
  ],

  twitch: {
    channel: 'guruflabba',
  },

  youtube: {
    channelId: 'UC97VCvtsAYxXqq7mLM24E_A',
    url: 'https://www.youtube.com/@guruflabba',
  },

  // PLACEHOLDER SCHEDULE — replace with the real one.
  // day:   MON TUE WED THU FRI SAT SUN
  // start: 24h time in `timezone` below
  // hours: how long the stream usually runs
  // Viewers see every slot converted to their own local time.
  schedule: {
    timezone: 'Europe/London',
    slots: [
      { day: 'MON', start: '19:00', hours: 3, title: 'TBA' },
      { day: 'WED', start: '19:00', hours: 3, title: 'TBA' },
      { day: 'FRI', start: '20:00', hours: 4, title: 'TBA' },
      { day: 'SUN', start: '15:00', hours: 3, title: 'TBA' },
    ],
  },

  // Words that flash for a split second every so often.
  subliminal: [
    'FOLLOW', 'SUBSCRIBE', 'STAY TUNED', 'WAKE UP', 'DON\'T BLINK',
    'THE GURU SEES YOU', 'PRESS START', 'OBEY THE GURU', 'YOU ARE PLAYER 1',
    'DO NOT ADJUST YOUR SET', 'REWIND', 'IT\'S ALREADY RECORDING',
  ],
};
