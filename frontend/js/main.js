import { initKeypad } from './keypad.js';
import { createRouter } from './router.js';
import mainMenu from './screens/mainMenu.js';
import home from './screens/home.js';
import { PriceAlerts } from './screens/priceAlerts.js';
import weather from './screens/weather.js';
import marketPrices from './screens/marketPrices.js';
import priceDetail from './screens/priceDetail.js';
import comingSoon from './screens/comingSoon.js';
import askAIHome from './screens/askAIHome.js';
import askAIInput from './screens/askAIInput.js';
import askAIThinking from './screens/askAIThinking.js';
import askAIAnswer, { AskAISources } from './screens/askAIAnswer.js';
import { AskAIMedia, AskAIPhoto, AskAIVoice, AskAIHistory } from './screens/askAIMedia.js';
import { AuthWelcome, AuthPhone, AuthPin, ProfileName, ProfileVillage, ProfileRegion, AuthResult, Settings, ProfileSummary, LanguageSettings, CropSettings, WelcomeLanguage } from './screens/identity.js';
import { getJSON } from './api.js';
import { setLanguage } from './i18n/index.js';
import { identity } from './state.js';
import farmerCircleHome from './screens/farmerCircleHome.js';
import postDetail from './screens/postDetail.js';
import forumOptions from './screens/forumOptions.js';
import forumGate from './screens/forumGate.js';
import userProfile from './screens/userProfile.js';
import createReply from './screens/createReply.js';
import { pickerScreens } from './screens/forumPicker.js';
import { MyPosts, SavedPosts } from './screens/forumCollections.js';
import { startMarketSync } from './market/marketSync.js';
import { MarketForm, MarketNumber, MarketText } from './market/marketForm.js';
import { MarketHome, MarketFeed, MarketFilter, MarketDetail } from './market/marketScreens.js';
import { MarketOffers, MarketOffer, MarketDeals, MarketDeal, MarketReason } from './market/marketTrades.js';
import { TradeConfirm } from './market/tradeConfirm.js';
import { CreatePostTitle, CreatePostBody, CreatePostTagsLoader, CreatePostPreview } from './screens/createPost.js';
import { farmOpsScreens } from './screens/farmOps.js';

const farmerCircle = {
  FarmerCircleHome: farmerCircleHome, PostDetail: postDetail, ForumOptions: forumOptions, UserProfile: userProfile,
  AuthGate: forumGate, CreateReply: createReply, MyPosts, SavedPosts, ...pickerScreens,
  CreatePostTitle, CreatePostBody, CreatePostTagsLoader, CreatePostPreview,
};

const screens = {
  Home: home, PriceAlerts, MainMenu: mainMenu, Weather: weather, MarketPrices: marketPrices, PriceDetail: priceDetail, ComingSoon: comingSoon,
  AskAIHome: askAIHome, AskAIInput: askAIInput, AskAIThinking: askAIThinking, AskAIAnswer: askAIAnswer,
  AskAISources, AskAIMedia, AskAIPhoto, AskAIVoice, AskAIHistory,
  AuthWelcome, AuthPhone, AuthPin, ProfileName, ProfileVillage, ProfileRegion, AuthResult, Settings, ProfileSummary, LanguageSettings, CropSettings, WelcomeLanguage,
  ...farmerCircle,
  MarketHome, MarketFeed, MarketFilter, MarketDetail, MarketForm, MarketNumber, MarketText, MarketOffers, MarketOffer, MarketDeals, MarketDeal, MarketReason, TradeConfirm,
  ...farmOpsScreens,
};
const $ = (id) => document.getElementById(id);

const router = createRouter({
  screens,
  els: { status: $('status'), content: $('content'), sl: $('sk-l'), sc: $('sk-c'), sr: $('sk-r') },
});
initKeypad(router.dispatch);
try {
  const session = await getJSON('/api/auth/session');
  identity.profile = session.user;
  if (session.user?.language && setLanguage(session.user.language)) await new Promise(() => {}); // reloading in the member's language
  router.start(session.user ? 'Home' : 'AuthWelcome');
} catch {
  // A local price-only demo may intentionally run without PostgreSQL/auth.
  router.start('AuthWelcome');
}
startMarketSync({ router });
