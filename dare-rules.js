// Dare/forfeit punishments - the family-friendly alternative to drinking mode.
// Used by the iOS app (App Store compliance) and offered as an option on the website.

module.exports = {
  // Dares for the person who got POINTED AT
  pointed: [
    "Do 10 push-ups",
    "Do your best impression of another player",
    "Speak in a foreign accent for the next round",
    "Tell everyone the last thing you searched online",
    "Sing the chorus of any song",
    "Do 15 jumping jacks",
    "Show the last photo on your camera roll",
    "Do a 30-second plank",
    "Compliment the person who pointed at you",
    "Tell your most embarrassing story (PG version)",
    "Hold a funny pose until your next turn",
    "Tell a joke - if no one laughs, do 5 push-ups",
    "Reveal the last text you sent",
    "Do a dramatic reading of the question",
    "Talk like a robot for the next round",
    "Stand up and do a victory dance",
    "Try to lick your elbow",
    "Spell your full name backwards",
    "Make up a 4-line poem about another player",
    "Do your best evil villain laugh",
    "Pretend to be a news anchor reading the headlines",
    "Take a silly selfie with another player",
    "Hum a song until someone guesses it",
    "Do your best impression of a famous person",
    "Tell the group your spirit animal and why",
  ],

  // Dares when the question IS REVEALED (heads)
  revealed: [
    "The whisperer has to do 10 push-ups for asking that",
    "Anyone who agrees with the answer has to stand up",
    "The pointed person picks anyone to do 5 jumping jacks",
    "Everyone makes their best surprised face on three",
    "The pointed person and the answerer high five",
    "Anyone who laughed has to tell a joke next round",
    "Group photo time - everyone strike a pose",
    "Youngest player tells an embarrassing story",
    "The pointed person takes a victory lap around the room",
    "Whisperer and answerer arm wrestle (or thumb wrestle)",
    "Everyone in the circle gives the pointed person a compliment",
    "The pointed person gets to ask the next question",
    "Everyone does one push-up in solidarity",
  ],

  // Dares when the question STAYS SECRET (tails)
  secret: [
    "The pointed person has to keep a straight face for 30 seconds",
    "Mystery dare - the answerer whispers a secret dare to the pointed person",
    "The whisperer and answerer trade seats",
    "Everyone closes their eyes and points - whoever they point at does 5 jumping jacks",
    "The pointed person has to use a silly voice next round",
    "Awkward eye contact for 10 seconds between answerer and pointed person",
    "Left side of the circle does 5 jumping jacks",
    "Right side of the circle does 5 jumping jacks",
    "The pointed person tells the group their lucky number",
    "Everyone in the circle says one nice thing about the pointed person",
  ],

  // Bonus challenges that can happen randomly
  challenges: [
    { trigger: "every5rounds", text: "BONUS ROUND: Everyone does 5 jumping jacks together!", type: "all" },
    { trigger: "every10rounds", text: "CHAOS ROUND: Last person to touch their nose does 10 push-ups!", type: "all" },
    { trigger: "random", text: "LIGHTNING ROUND: Next 3 rounds have double dares!", type: "modifier" },
    { trigger: "random", text: "SNIPER ROUND: The answerer picks TWO people this round!", type: "modifier" },
    { trigger: "random", text: "REVERSE: The person pointed at gets to ask the next question!", type: "modifier" },
  ],

  // Intensity levels (kept the same shape as drinking-rules for compatibility)
  intensities: {
    casual: { sipMultiplier: 1, shotChance: 0, description: "Easy mode - light dares" },
    medium: { sipMultiplier: 1, shotChance: 0, description: "Standard dares" },
    heavy: { sipMultiplier: 1, shotChance: 0, description: "Tougher dares" },
    blackout: { sipMultiplier: 1, shotChance: 0, description: "Maximum chaos" },
  }
};
