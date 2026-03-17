// Drinking game punishments - assigned to the person who gets pointed at
// OR to everyone, depending on the rule type

module.exports = {
  // Punishments for the person who got POINTED AT
  pointed: [
    "Take 2 sips 🍺",
    "Take 3 sips 🍺🍺",
    "Take a shot 🥃",
    "Finish your drink 🍷",
    "Waterfall for 5 seconds 🌊",
    "Drink with your non-dominant hand for the next 3 rounds 🤚",
    "Take a sip every time someone looks at you for the next round 👀",
    "Take 2 big gulps 🍺",
    "Shotgun a beer (or take 3 sips if no cans) 🍻",
    "Drink for as many seconds as your age's last digit ⏱️",
    "Take a sip and make a toast to the person who pointed at you 🥂",
    "Body shot off the person to your left (or take 2 shots) 🔥",
    "Take a sip for every person in the room 😵",
    "Drink and tell everyone your most embarrassing story 📖",
    "Take a shot with no chaser 🥃",
    "Drink and do your best impression of the person who pointed at you 🎭",
    "Take a penalty sip and switch drinks with someone 🔄",
    "Drink and reveal the last photo on your camera roll 📸",
    "Take 2 sips and send a risky text (group approves) 📱",
    "Finish half your drink 🍺",
    "Drink and do 10 pushups (or take another shot) 💪",
    "Take a sip and compliment the person who pointed at you 💕",
    "Drink and let someone post on your Instagram story 📲",
    "Take a sip for every vowel in your name 🔤",
    "Social drink! Everyone takes a sip with you 🎉",
  ],

  // Punishments when the question IS REVEALED (heads)
  revealed: [
    "The WHISPERER drinks for asking that question 😈",
    "Everyone who agrees with the answer takes a sip 🍺",
    "The person pointed at AND the answerer both drink 🍻",
    "The person pointed at chooses someone else to drink with them 🫂",
    "Everyone drinks except the person pointed at 🎯",
    "The whisperer and the pointed person do a cheers and drink 🥂",
    "Anyone who laughed takes a sip 😂",
    "The person pointed at assigns 3 sips to anyone 👉",
    "Youngest person in the room drinks 👶",
    "Oldest person in the room drinks 👴",
    "Last person to raise their hand drinks ✋",
    "Everyone takes a group shot 🥃",
    "The pointed person starts a waterfall ⬇️",
  ],

  // Punishments when the question STAYS SECRET (tails)
  secret: [
    "The answerer takes a mystery sip for keeping secrets 🤫",
    "Everyone takes a sip of suspicion 🕵️",
    "The person pointed at takes a paranoia sip - they'll never know why 😰",
    "The whisperer and answerer both drink for their secret 🤐",
    "Nobody drinks... the paranoia is punishment enough 💀",
    "The person pointed at takes 2 paranoia sips 😱",
    "Left side of the circle drinks 👈",
    "Right side of the circle drinks 👉",
    "Everyone stares at the pointed person while they take a sip 👁️",
    "The pointed person has to drink and maintain eye contact with the answerer 👀",
  ],

  // Bonus challenges that can happen randomly
  challenges: [
    { trigger: "every5rounds", text: "🎰 BONUS ROUND: Everyone takes a shot!", type: "all" },
    { trigger: "every10rounds", text: "🔥 CHAOS ROUND: Last person to touch their nose finishes their drink!", type: "all" },
    { trigger: "random", text: "⚡ LIGHTNING ROUND: Next 3 rounds are double punishments!", type: "modifier" },
    { trigger: "random", text: "🎯 SNIPER ROUND: The answerer picks TWO people this round!", type: "modifier" },
    { trigger: "random", text: "🔄 REVERSE: The person pointed at gets to ask the next question!", type: "modifier" },
  ],

  // Intensity levels
  intensities: {
    casual: { sipMultiplier: 1, shotChance: 0.1, description: "Chill vibes - mostly sips" },
    medium: { sipMultiplier: 1.5, shotChance: 0.25, description: "Getting spicy - some shots mixed in" },
    heavy: { sipMultiplier: 2, shotChance: 0.5, description: "No mercy - frequent shots" },
    blackout: { sipMultiplier: 3, shotChance: 0.75, description: "You've been warned 💀" },
  }
};
