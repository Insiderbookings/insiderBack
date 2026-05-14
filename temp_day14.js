const hotelName='Test';
const performance={favorites:1,clicks:2};
const setup={profileCompletion:70,inquiryFeatureEnabled:false,inquiryReady:false,inquiryLabel:'Needs inbox'};
function formatCount(n){return n;}
const x = {
  bullets: [
    `Saved to favorites so far: ${formatCount(performance.favorites)}.`,
    "Review this week what similar hotels are doing: clean photos, strong amenities and a clear contact workflow.",
    performance.clicks > 0 || performance.favorites > 0
      ? `Traveler intent is starting to show up beyond raw visibility${performance.clicks > 0 && performance.favorites > 0 ? ", in both clicks and saves." : "."}`
      : "Visibility is building, but traveler intent is still light enough that listing improvements can matter before the second half of the trial.",
    setup.profileCompletion != null && setup.profileCompletion < 80
      ? `The listing is still ${setup.profileCompletion}% complete. Improving copy, photos and amenities can help the traffic already coming in convert better.`
      : setup.inquiryFeatureEnabled && !setup.inquiryReady
        ? "Finish the inquiry setup now so any late-trial traveler interest has a direct route into the hotel inbox."
        : "Your listing fundamentals are in good shape, so the next focus is keeping the message current while the trial keeps running.",
  ],
};
