/**
 * ARCHIVED FILE
 * Preserved legacy burner email edge function implementation.
 * Original: supabase/functions/generate-burner-email/index.ts
 * Archived: 2026-04-17
 * Reason: Added 50% character mismatch validation for generated aliases.
 */
// @ts-nocheck - Deno Edge Function with npm: specifiers resolved at runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "npm:jose@5";

type DenoRuntime = {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const denoRuntime = (globalThis as typeof globalThis & { Deno?: DenoRuntime }).Deno;

if (!denoRuntime) {
  throw new Error("Deno runtime is required for this function");
}

const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
const supabaseKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
const jwtPublicKeyJwkEnv = denoRuntime.env.get("JWT_PUBLIC_KEY");
const jwtIssuer = denoRuntime.env.get("JWT_ISSUER") ?? "privaseer-burner-auth";
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  : null;

let cachedPublicVerificationKey: jose.KeyLike | null = null;

async function getPublicVerificationKey(): Promise<jose.KeyLike> {
  if (cachedPublicVerificationKey) return cachedPublicVerificationKey;
  if (!jwtPublicKeyJwkEnv) {
    throw new Error("JWT public key not configured");
  }
  const jwk = JSON.parse(jwtPublicKeyJwkEnv);
  cachedPublicVerificationKey = await jose.importJWK(jwk, "ES256");
  return cachedPublicVerificationKey;
}

// ============= Inlined validation functions =============
interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: any;
}

function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required and must be a string' };
  }
  const trimmed = email.trim();
  if (trimmed.length === 0) return { valid: false, error: 'Email cannot be empty' };
  if (trimmed.length > 254) return { valid: false, error: 'Email is too long (max 254 characters)' };
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(trimmed)) return { valid: false, error: 'Invalid email format' };
  const [localPart, domain] = trimmed.split('@');
  if (localPart.length > 64) return { valid: false, error: 'Email local part is too long (max 64 characters)' };
  if (domain.length > 255) return { valid: false, error: 'Email domain is too long (max 255 characters)' };
  return { valid: true, sanitized: trimmed.toLowerCase() };
}

function validateUUID(uuid: string): ValidationResult {
  if (!uuid || typeof uuid !== 'string') return { valid: false, error: 'UUID is required and must be a string' };
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) return { valid: false, error: 'Invalid UUID format' };
  return { valid: true, sanitized: uuid.toLowerCase() };
}

function validateString(value: string, fieldName: string, options: { required?: boolean; maxLength?: number } = {}): ValidationResult {
  if (!value || typeof value !== 'string') {
    if (options.required) return { valid: false, error: `${fieldName} is required and must be a string` };
    return { valid: true, sanitized: '' };
  }
  const trimmed = value.trim();
  if (options.required && trimmed.length === 0) return { valid: false, error: `${fieldName} cannot be empty` };
  if (options.maxLength && trimmed.length > options.maxLength) return { valid: false, error: `${fieldName} must be at most ${options.maxLength} characters` };
  return { valid: true, sanitized: trimmed };
}

function validateNumber(value: any, fieldName: string, options: { min?: number; max?: number; integer?: boolean } = {}): ValidationResult {
  if (value === undefined || value === null) return { valid: true, sanitized: undefined };
  const num = Number(value);
  if (isNaN(num)) return { valid: false, error: `${fieldName} must be a valid number` };
  if (options.integer && !Number.isInteger(num)) return { valid: false, error: `${fieldName} must be an integer` };
  if (options.min !== undefined && num < options.min) return { valid: false, error: `${fieldName} must be at least ${options.min}` };
  if (options.max !== undefined && num > options.max) return { valid: false, error: `${fieldName} must be at most ${options.max}` };
  return { valid: true, sanitized: num };
}

function validateGenerateEmailRequest(body: any, installationIdFromJwt?: string): ValidationResult {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Request body must be an object' };
  
  // installationId can come from JWT (preferred) or body (legacy support)
  let installationId = installationIdFromJwt;
  if (!installationId) {
    const installationIdValidation = validateUUID(body.installationId || '');
    if (!installationIdValidation.valid) return { valid: false, error: `Installation ID: ${installationIdValidation.error}` };
    installationId = installationIdValidation.sanitized;
  }
  
  const realEmailValidation = validateEmail(body.realEmail || '');
  if (!realEmailValidation.valid) return { valid: false, error: `Real email: ${realEmailValidation.error}` };
  
  // Accept both 'domain' and 'siteDomain' for compatibility
  const domainValue = body.domain || body.siteDomain || '';
  const domainValidation = validateString(domainValue, 'Domain', { required: true, maxLength: 255 });
  if (!domainValidation.valid) return { valid: false, error: domainValidation.error };
  
  const urlValidation = validateString(body.url || '', 'URL', { maxLength: 2048 });
  if (!urlValidation.valid) return { valid: false, error: urlValidation.error };
  const labelValidation = validateString(body.label || '', 'Label', { maxLength: 255 });
  if (!labelValidation.valid) return { valid: false, error: labelValidation.error };
  const descriptionValidation = validateString(body.description || '', 'Description', { maxLength: 500 });
  if (!descriptionValidation.valid) return { valid: false, error: descriptionValidation.error };
  const expiresInDaysValidation = validateNumber(body.expiresInDays, 'Expires in days', { min: 1, max: 365, integer: true });
  if (!expiresInDaysValidation.valid) return { valid: false, error: expiresInDaysValidation.error };
  return {
    valid: true,
    sanitized: {
      installationId,
      realEmail: realEmailValidation.sanitized,
      domain: domainValidation.sanitized,
      url: urlValidation.sanitized,
      label: labelValidation.sanitized,
      description: descriptionValidation.sanitized,
      expiresInDays: expiresInDaysValidation.sanitized,
    },
  };
}

function createValidationErrorResponse(error: string): Response {
  return new Response(JSON.stringify({ error: 'Validation error', message: error }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

async function authenticateRequest(req: Request): Promise<{ installationId: string; claims: jose.JWTPayload }> {
  if (!supabase) {
    throw new Error("Supabase client not configured");
  }
  if (!jwtPublicKeyJwkEnv) {
    throw new Error("JWT public key not configured");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Promise.reject(new Response(
      JSON.stringify({ error: "Missing authorization" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    ));
  }

  const token = authHeader.slice(7);
  try {
    const verificationKey = await getPublicVerificationKey();
    const { payload } = await jose.jwtVerify(token, verificationKey, {
      algorithms: ["ES256"],
      issuer: jwtIssuer,
    });
    const installationId = payload.sub as string;
    if (!installationId) {
      throw new Error("Token missing subject");
    }
    return { installationId, claims: payload };
  } catch (error) {
    console.error("JWT verification failed", error);
    return Promise.reject(new Response(
      JSON.stringify({ error: "Invalid authorization token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    ));
  }
}

async function enforceRateLimit(installationId: string) {
  if (!supabase) return;
  const { data, error } = await supabase.rpc("check_generation_limits", { p_installation_id: installationId });
  if (error) {
    throw error;
  }
  if (!data?.allowed) {
    const reason = data?.reason === "hourly_limit"
      ? "Hourly burner email limit reached"
      : data?.reason === "daily_limit"
        ? "Daily burner email limit reached"
        : "Burner email generation temporarily blocked";
    throw new Response(
      JSON.stringify({ error: reason }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}

async function recordGeneration(installationId: string) {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc("log_generation_event", { p_installation_id: installationId });
    if (error) {
      console.error("Failed to log generation event", error);
    }
  } catch (err) {
    console.error("Failed to log generation event", err);
  }
}

// ============= Inlined word lists for Deno Deploy compatibility =============
const adjectives = [
  "able","active","adorable","adventurous","affable","agile","alert","amazing","ambitious","amiable",
  "ancient","angelic","animated","artistic","astute","athletic","attentive","audacious","authentic","awesome",
  "balanced","bashful","beaming","beautiful","beloved","benevolent","best","better","big","blazing",
  "blissful","blithe","blooming","bold","bonny","boundless","brainy","brave","breezy","brief",
  "bright","brilliant","brisk","broad","bubbly","buoyant","busy","calm","candid","capable",
  "carefree","careful","caring","casual","celestial","central","certain","champion","charming","cheerful",
  "cherry","chic","chief","chipper","chivalrous","choice","civil","classic","clean","clear",
  "clever","close","cloudy","coastal","colossal","colorful","comely","comfy","comic","common",
  "compact","complete","composed","confident","constant","content","cool","cooperative","coral","cordial",
  "cosmic","cosy","courageous","courteous","cozy","crafty","creative","crisp","crystal","cultured",
  "cunning","curious","curly","current","cute","dainty","dandy","dapper","daring","darling",
  "dashing","dazzling","dear","decent","decisive","deep","delicate","delightful","dependable","determined",
  "devoted","diamond","different","diligent","diplomatic","direct","discreet","distinct","divine","dizzy",
  "docile","dogged","doting","double","downtown","dreamy","driven","durable","dusty","dutiful",
  "dynamic","eager","early","earnest","earthly","easy","eclectic","edgy","educated","effective",
  "efficient","effortless","elaborate","elastic","elated","electric","elegant","elite","eloquent","emerald",
  "eminent","emotional","enchanted","enchanting","endless","enduring","energetic","engaging","enigmatic","enormous",
  "enterprising","entertaining","enthusiastic","entire","epic","equal","essential","eternal","ethereal","ethical",
  "even","eventual","evergreen","everlasting","exact","excellent","exceptional","excited","exciting","exclusive",
  "exotic","expert","exquisite","extra","extraordinary","fabulous","factual","fair","faithful","familiar",
  "famous","fancy","fantastic","far","fascinating","fashionable","fast","favorable","fearless","feisty",
  "festive","few","fierce","fiery","fine","first","fit","fitting","flashy","flawless",
  "fleet","flexible","flickering","flourishing","flowing","fluent","fluffy","flying","focal","focused",
  "fond","foolproof","forceful","foremost","forest","forgiving","formal","formidable","forthright","fortunate",
  "forward","foxy","fragrant","frank","free","fresh","friendly","frugal","fruitful","full",
  "fun","functional","fundamental","funny","furry","future","fuzzy","gallant","game","gaudy",
  "general","generous","genial","genius","gentle","genuine","giant","gifted","giving","glad",
  "glamorous","gleaming","gleeful","glimmering","glistening","glittering","global","glorious","glossy","glowing",
  "golden","good","goodly","gorgeous","graceful","gracious","grand","grateful","great","green",
  "gregarious","groovy","grounded","growing","guarded","guided","guileless","gutsy","hallowed","handsome",
  "handy","happy","hardy","harmless","harmonious","healthy","hearty","heavenly","helpful","heroic",
  "hidden","high","hilarious","hip","historic","holistic","holy","homely","honest","honorable",
  "hopeful","hospitable","hot","huge","humble","humorous","hushed","hyper","ideal","idyllic",
  "illuminated","illustrious","imaginative","immaculate","immense","immortal","impartial","impeccable","imperial","important",
  "impressive","improved","incredible","independent","indoor","industrious","infinite","influential","ingenious","initial",
  "inner","innocent","innovative","inquisitive","insightful","inspired","inspiring","instant","integral","intellectual",
  "intelligent","intense","intentional","interesting","internal","intimate","intrepid","intuitive","inventive","invincible",
  "invisible","inviting","iridescent","irresistible","jade","jaunty","jazzy","jeweled","jocular","jolly",
  "jovial","joyful","joyous","jubilant","judicious","juicy","jumbo","jumping","junior","just",
  "keen","key","kind","kindred","kingly","kissable","knightly","knowing","known","large",
  "lasting","late","laughing","lavish","lawful","leading","lean","learned","legal","legendary",
  "legit","leisurely","level","liberal","light","likable","likely","limber","limited","linear",
  "literate","little","live","lively","living","local","lofty","logical","long","loose",
  "loud","lovable","lovely","loving","loyal","lucent","lucid","lucky","luminous","lunar",
  "lush","lustrous","luxurious","lyrical","made","magic","magical","magnetic","magnificent","majestic",
  "major","mammoth","many","marvelous","massive","master","masterful","matchless","material","mature",
  "maximum","meaningful","measured","meditative","mellow","melodic","memorable","merciful","merry","mesmerizing",
  "metallic","meteoric","meticulous","mighty","mild","mindful","minimal","mint","miraculous","mirthful",
  "mobile","model","modern","modest","momentous","monumental","moral","motivated","moving","much",
  "multi","municipal","musical","mutual","mysterious","mystic","mystical","mythic","naive","narrow",
  "national","native","natural","naval","near","neat","necessary","neighborly","neutral","new",
  "next","nice","nifty","nimble","noble","nocturnal","nominal","normal","notable","noted",
  "novel","numerous","nurturing","objective","observant","obvious","odd","official","okay","old",
  "omniscient","open","openhearted","optimal","optimistic","opulent","orange","orderly","organic","original",
  "ornate","outdoor","outer","outgoing","outstanding","overt","pacific","painless","palatial","pale",
  "panoramic","parallel","paramount","partial","particular","passionate","passive","past","pastoral","patient",
  "patriotic","peaceful","peachy","peak","peerless","peppy","perceptive","perfect","periodic","perky",
  "permanent","perpetual","persistent","personal","persuasive","petite","phenomenal","philosophical","physical","picturesque",
  "pilot","pioneering","pious","pivotal","placid","plain","planetary","plausible","playful","pleasant",
  "pleased","pleasing","plentiful","plucky","plush","poetic","poised","polished","polite","popular",
  "portable","positive","possible","potent","powerful","practical","pragmatic","praiseworthy","precious","precise",
  "preferred","premier","premium","prepared","present","presidential","prestigious","pretty","priceless","primal",
  "primary","prime","primo","princely","principal","pristine","private","prized","pro","proactive",
  "probable","productive","professional","proficient","profound","progressive","prolific","prominent","promising","prompt",
  "proper","prophetic","prosperous","protective","proud","proven","prudent","public","pumped","punctual",
  "pure","purple","purposeful","quaint","qualified","quality","quantum","queenly","quick","quiet",
  "quirky","radiant","radical","rapid","rare","rational","ravishing","ready","real","realistic",
  "reasonable","recent","reckless","recognized","refined","reflective","refreshing","regal","regular","reliable",
  "relieved","remarkable","renowned","reputable","resilient","resolute","resourceful","respected","respectful","responsible",
  "restful","revered","rewarding","rich","right","righteous","ripe","rising","ritzy","riveting",
  "roaring","robust","rocking","romantic","roomy","rosy","round","royal","ruby","rugged",
  "ruling","rustic","sacred","safe","sage","saintly","sanguine","sapphire","sassy","satisfied",
  "saving","savvy","scenic","scholarly","scientific","scintillating","seasoned","secret","secure","sedate",
  "seemly","select","selective","selfless","sensational","sensible","sensitive","serene","serious","settled",
  "several","sharp","sheer","sheltered","shimmering","shining","shiny","shipshape","shrewd","silent",
  "silken","silky","silver","similar","simple","sincere","singular","sizable","skilled","skillful",
  "sleek","slick","slight","slim","smart","smashing","smiling","smooth","snappy","snazzy",
  "snug","snuggly","soaring","sober","social","sociable","soft","solar","sole","solemn",
  "solid","solitary","sonic","soothing","sophisticated","sought","soulful","sound","southern","spacious",
  "sparkling","special","spectacular","speedy","spellbound","spherical","spicy","spirited","spiritual","splendid",
  "spontaneous","sporting","sportive","sporty","spotless","sprightly","spry","square","stable","stainless",
  "standard","standing","star","stark","starry","stately","staunch","steadfast","steady","stellar",
  "sterling","still","stimulating","stirring","stocky","stoic","stoked","storied","stout","straight",
  "strategic","streamlined","street","striking","strong","studious","stunning","stupendous","sturdy","stylish",
  "suave","sublime","substantial","subtle","successful","succinct","sufficient","sugary","suitable","sultry",
  "summary","summery","sumptuous","sunny","super","superb","superior","supple","supportive","supreme",
  "sure","surreal","sustainable","svelte","sweet","swift","sympathetic","systematic","tactful","talented",
  "tall","tame","tangible","tasteful","tasty","taut","tenacious","tender","terrific","thankful",
  "therapeutic","thick","thorough","thoughtful","thrilling","thriving","tidy","tight","timeless","timely",
  "tireless","titanic","together","tolerant","top","topnotch","total","tough","traditional","tranquil",
  "transcendent","transparent","tremendous","trendy","tribal","trim","triple","triumphant","tropical","true",
  "trusting","trustworthy","trusty","truthful","twinkling","typical","ultimate","ultra","unassuming","unbeatable",
  "unbiased","unconditional","undeniable","understanding","understood","undisputed","unfailing","unforgettable","unified","unique",
  "united","universal","unlimited","unmatched","unparalleled","unreal","unrivaled","unshakable","unusual","unwavering",
  "upbeat","upcoming","updated","uplifting","upper","upright","upscale","upstanding","upward","urban",
  "urgent","usable","useful","usual","utmost","utter","valiant","valid","valuable","valued",
  "vanilla","varied","vast","vegan","velvet","venerable","venturous","verified","versatile","very",
  "veteran","viable","vibrant","victorious","vigilant","vigorous","vintage","violet","virtual","virtuous",
  "visible","visionary","vital","vivacious","vivid","vocal","volcanic","voluntary","warm","wealthy",
  "weekly","welcome","welcoming","well","western","whimsical","white","whole","wholesome","wide",
  "wild","willing","winning","wintry","wired","wise","witty","wizardly","woke","wonderful",
  "wondrous","wooden","worldly","worldwide","worshipful","worth","worthwhile","worthy","youthful","zany",
  "zealous","zen","zesty","zippy","zodiac","zonal","alpine","amber","aqua","arctic",
  "autumn","azure","bamboo","birch","bloom","blossom","breeze","brook","canyon","cedar",
  "cherry","cliff","cloud","clover","cobalt","copper","coral","cotton","creek","crimson",
  "cypress","daisy","dawn","delta","desert","dew","dove","dune","dusk","ebony",
  "elm","ember","fern","field","fjord","flame","flora","flower","foam","fog",
  "frost","garden","garnet","glade","glen","glow","granite","grass","grove","harbor",
  "harvest","haven","hazel","heath","heather","hedge","herb","highland","hill","hollow",
  "honey","horizon","ice","indigo","iris","island","ivory","ivy","jasmine","jet",
  "jungle","lake","laurel","lava","lavender","lawn","leaf","lemon","lilac","lily",
  "lime","linen","lotus","magnolia","mango","maple","marble","marine","marsh","meadow",
  "midnight","mineral","mist","misty","moon","moss","mountain","mulberry","nectar","oak",
  "oasis","ocean","olive","onyx","opal","orchid","palm","paper","peach","pearl",
  "pebble","pepper","pine","pink","plum","polar","pond","poplar","poppy","prairie",
  "prism","pumpkin","quartz","rain","rainbow","rainy","ravine","reef","ridge","river",
  "rock","rose","russet","saffron","sand","sandy","savanna","scarlet","sea","shadow",
  "shore","silk","sky","slate","smoke","snow","snowy","spring","spruce","stellar",
  "stone","storm","stream","summer","summit","sun","sunrise","sunset","surf","teal",
  "terra","thunder","tide","timber","topaz","trail","tree","tulip","turquoise","twilight",
  "valley","verdant","volcano","walnut","wave","wheat","willow","wind","windy","winter",
  "wisteria","wood","woodland","yarrow","zephyr","binary","bit","byte","cache","chip",
  "circuit","code","cyber","data","digital","disk","echo","fiber","flash","flux",
  "gamma","gigabit","grid","hash","helix","hex","ion","kernel","laser","link",
  "logic","loop","matrix","mega","mesh","metro","micro","nano","net","neural",
  "nexus","node","nova","omega","orbit","oxide","particle","phase","photon","pixel",
  "plasma","port","probe","proto","pulse","quark","radar","radio","ray","reactor",
  "relay","retro","robo","rocket","satellite","scalar","scan","sector","serial","server",
  "signal","silicon","spark","spectrum","sphere","static","stealth","sync","techno","tensor",
  "terminal","tesla","thermal","titan","token","turbo","unified","unit","vector","vertex",
  "void","volt","vortex","wifi","wire","zero","zone"
];

const nouns = [
  "albatross","alpaca","ant","antelope","ape","armadillo","badger","bat","bear","beaver",
  "bee","beetle","bison","bluebird","boar","bobcat","buffalo","butterfly","camel","canary",
  "capybara","cardinal","caribou","cat","catfish","cheetah","chipmunk","clam","cobra","cockatoo",
  "cod","condor","coral","cougar","cow","coyote","crab","crane","cricket","crocodile",
  "crow","cuckoo","deer","dingo","dog","dolphin","donkey","dove","dragon","dragonfly",
  "duck","eagle","eel","egret","elephant","elk","emu","falcon","ferret","finch",
  "firefly","fish","flamingo","fly","fox","frog","gazelle","gecko","gerbil","giraffe",
  "goat","goldfish","goose","gorilla","grasshopper","grizzly","groundhog","grouse","gull","hamster",
  "hare","hawk","hedgehog","heron","hippo","hornet","horse","hound","hummingbird","hyena",
  "ibis","iguana","impala","jackal","jaguar","jay","jellyfish","kangaroo","kestrel","kingfisher",
  "kite","kiwi","koala","koi","komodo","ladybug","lark","lemur","leopard","lion",
  "lizard","llama","lobster","locust","loon","lynx","macaw","magpie","mallard","mammoth",
  "manatee","mandrill","mantis","marlin","marmot","marten","meadowlark","meerkat","mockingbird","mole",
  "mongoose","monkey","moose","moth","mouse","mule","mussel","narwhal","newt","nightingale",
  "ocelot","octopus","okapi","opossum","orangutan","orca","oriole","osprey","ostrich","otter",
  "owl","ox","oyster","panda","panther","parakeet","parrot","partridge","peacock","pelican",
  "penguin","perch","pheasant","pig","pigeon","pike","piranha","platypus","pony","porcupine",
  "porpoise","possum","prawn","puffin","puma","python","quail","rabbit","raccoon","ram",
  "raven","reindeer","rhino","roadrunner","robin","rooster","salamander","salmon","sardine","scorpion",
  "seagull","seahorse","seal","shark","sheep","shrimp","skylark","sloth","snail","snake",
  "sparrow","spider","squid","squirrel","stag","starfish","starling","stingray","stork","sturgeon",
  "swan","swift","swordfish","tapir","tarpon","termite","tern","thrush","tiger","toad",
  "toucan","trout","tuna","turkey","turtle","unicorn","viper","vulture","wallaby","walrus",
  "warthog","wasp","weasel","whale","wildcat","wolf","wolverine","wombat","woodpecker","wren",
  "yak","zebra","acorn","aurora","avalanche","basin","bay","beach","blizzard","blossom",
  "boulder","breeze","brook","canyon","cascade","cave","cavern","cedar","cliff","cloud",
  "coast","cove","crater","creek","crest","delta","desert","dew","dune","dust",
  "earth","ember","estuary","evergreen","fern","field","fjord","flame","flare","flower",
  "fog","forest","frost","garden","geyser","glacier","glade","glen","gorge","granite",
  "grass","grove","harbor","haven","heath","hill","hollow","horizon","hurricane","ice",
  "inlet","island","jungle","lagoon","lake","lava","leaf","lightning","lotus","marsh",
  "meadow","mesa","meteor","mist","monsoon","moon","moss","mountain","nebula","oasis",
  "ocean","orchid","peak","pebble","peninsula","pine","plain","planet","plateau","pond",
  "prairie","quake","rain","rainbow","rapids","ravine","reef","ridge","river","rock",
  "sand","savanna","sea","shadow","shore","sky","snow","spring","star","stone",
  "storm","stream","summit","sun","sunrise","sunset","surf","swamp","tempest","thunder",
  "tide","timber","tornado","trail","tree","tsunami","tundra","valley","volcano","waterfall",
  "wave","willow","wind","winter","woods","anchor","anvil","arrow","atlas","badge",
  "balloon","banner","barrel","basket","beacon","bell","blade","blanket","board","boat",
  "book","boot","bottle","bow","box","branch","brick","bridge","brush","bucket",
  "button","cable","cage","camera","candle","cannon","canvas","cape","card","carpet",
  "cart","castle","chain","chair","chalk","chest","chimney","chip","clock","cloth",
  "clover","coat","coin","column","compass","cone","cord","cork","corner","couch",
  "cradle","crown","crystal","cube","cup","curtain","cushion","dagger","desk","dial",
  "diamond","dice","disk","dome","door","drum","engine","fan","feather","fence",
  "fiber","flag","flask","flute","fork","frame","funnel","gadget","gate","gem",
  "glass","globe","glove","gong","grain","guitar","hammer","handle","harp","harness",
  "hat","hatch","helm","helmet","hook","horn","hourglass","jar","jewel","journal",
  "jug","keel","kettle","key","keystone","knife","knob","knot","ladder","lamp",
  "lantern","latch","lens","lever","lid","line","link","lock","locket","loom",
  "loop","magnet","mail","mantle","map","marble","mask","mast","medal","medallion",
  "mirror","mold","mortar","mosaic","motor","mug","nail","needle","nest","net",
  "note","oar","orb","organ","paddle","page","pail","pan","panel","paper",
  "parcel","patch","path","pearl","pedal","pen","pencil","pendant","piano","pick",
  "pillar","pillow","pin","pipe","pivot","plane","plank","plate","plow","plug",
  "pocket","pod","pole","portal","post","pot","pouch","press","prism","propeller",
  "pulley","pump","quill","rack","rail","ramp","ring","rivet","rod","roll",
  "roof","rope","rudder","rug","ruler","saddle","sail","scale","scanner","scarf",
  "scope","screen","scroll","seal","seam","seat","shade","shaft","sheath","sheet",
  "shelf","shell","shield","ship","shuttle","signal","silo","sketch","slab","slate",
  "sled","sleeve","sling","socket","sofa","spark","spear","sphere","spike","spindle",
  "spiral","spoke","spool","spoon","staff","stage","stair","stake","stamp","stand",
  "staple","strap","string","stripe","switch","sword","symbol","table","tablet","tack",
  "tag","tank","tape","target","tent","thread","throne","tile","tin","token",
  "tool","torch","tower","track","trailer","train","trap","tray","treble","triangle",
  "trophy","trunk","tube","tunnel","turret","umbrella","urn","valve","van","vane",
  "vase","vault","veil","vessel","visor","wagon","wand","watch","wedge","wheel",
  "whistle","wick","widget","window","wing","wire","wreath","yacht","zipper","advent",
  "aether","agenda","alchemy","alliance","alpha","ambition","anthem","apex","arc","archive",
  "aria","aura","axiom","balance","ballad","beta","bliss","bloom","bond","boom",
  "boost","bounty","cache","cadence","calm","cascade","catalyst","chapter","charm","charter",
  "cipher","circuit","clarity","climax","code","comet","command","concept","contrast","core",
  "cosmos","courage","covenant","craft","creed","crusade","cycle","dawn","destiny","dimension",
  "doctrine","domain","drift","drive","dusk","dynamo","echo","eclipse","edge","element",
  "emblem","empire","endeavor","energy","enigma","epoch","era","essence","ethos","event",
  "exodus","facet","factor","fame","fate","flair","flight","flow","flux","focus",
  "force","forge","form","formula","fortune","fountain","freedom","frontier","fusion","future",
  "galaxy","gateway","genesis","genius","glow","grace","gravity","grid","guild","gusto",
  "harmony","heart","herald","hero","honor","hope","hub","hue","icon","idea",
  "ideal","identity","illusion","image","impact","impulse","index","infinity","insight","instinct",
  "intellect","intent","ion","journey","joy","junction","karma","kernel","kindle","kingdom",
  "knight","lancer","landmark","latitude","lattice","launch","layer","league","legacy","legend",
  "level","liberty","lift","light","limit","logic","lore","luck","lumen","luster",
  "mantra","margin","mark","matrix","maxim","memory","merit","method","metric","might",
  "mind","mission","mode","model","moment","momentum","motive","motto","muse","mystery",
  "myth","narrative","nature","nerve","network","nexus","noble","node","norm","north",
  "notion","nova","nucleus","oath","odyssey","omega","omen","onset","opal","opera",
  "opus","oracle","orbit","order","origin","outlook","pace","pact","paradigm","paradox",
  "parallel","paragon","passion","pattern","pause","phase","phoenix","pilot","pinnacle","pivot",
  "plan","pledge","plume","point","poise","power","praxis","precision","presence","pride",
  "prime","principle","probe","process","profile","progress","promise","proof","protocol","prowess",
  "pulse","purpose","pursuit","quanta","quantum","quest","quota","radiance","radius","rally",
  "range","rank","rapture","ratio","ray","reach","realm","reason","reckoning","record",
  "reflex","reign","relay","reliance","remedy","renown","resolve","resonance","respect","response",
  "rhythm","riddle","rift","rise","rite","ritual","rival","road","rogue","role",
  "root","route","routine","royalty","rule","rune","rush","saga","sage","salute",
  "sanction","sanctuary","schema","scheme","scholar","science","scope","scout","script","sector",
  "seed","sense","sentinel","sequence","serenity","series","service","session","shape","shift",
  "shine","signet","silence","silhouette","silver","simplicity","skill","slogan","solace","solstice",
  "solution","sonata","song","soul","source","space","span","spectrum","speed","spirit",
  "splendor","sprint","squad","stance","standard","status","stealth","steam","steel","step",
  "stimulus","stitch","story","strategy","streak","strength","stride","strike","stroke","structure",
  "studio","study","style","surge","surplus","survey","sync","synergy","syntax","system",
  "tactic","talent","tango","task","team","tempo","tenor","tension","term","terrain",
  "testament","texture","theory","thesis","thirst","thought","threshold","thrill","thrust","tier",
  "time","titan","title","tone","torque","touch","tour","trace","trade","tradition",
  "trait","trance","transit","treasure","treaty","trend","trial","tribute","trigger","trinity",
  "triumph","truce","trust","truth","tune","turbo","twilight","twist","unity","universe",
  "upgrade","uprising","urge","utopia","valor","value","vanguard","variance","vector","velocity",
  "venture","verdict","verge","version","vertex","victory","view","vigor","virtue","vision",
  "vista","vitality","voice","void","volt","volume","vortex","vow","voyage","wake",
  "ward","warrant","warp","wavelength","wealth","whirl","will","wisdom","wish","wit",
  "wonder","word","work","world","worth","wrath","zenith","zephyr","zest","zoom",
  "algorithm","analog","android","antenna","app","array","atom","avatar","axis","bandwidth",
  "blockchain","bot","browser","buffer","byte","channel","client","cluster","codec","compile",
  "config","console","cookie","crypto","cursor","daemon","dashboard","data","database","debug",
  "decrypt","depot","device","download","driver","drone","electron","email","embed","emoji",
  "encode","encrypt","ethernet","export","extension","extract","file","filter","firewall","firmware",
  "format","framework","frequency","function","gigabyte","glitch","gradient","graphics","hack","hardware",
  "header","helix","hex","host","hyperlink","import","input","instance","interface","internet",
  "keyframe","layout","library","linux","load","localhost","login","macro","mainframe","malware",
  "megabyte","menu","metadata","microchip","microwave","middleware","mobile","modem","module","monitor",
  "motherboard","neuron","notification","object","offline","online","open","operating","operator","optical",
  "output","overflow","packet","parser","partition","password","patch","payload","peer","peripheral",
  "permission","ping","pipeline","platform","plugin","podcast","pointer","prefix","printer","processor",
  "program","prompt","proxy","query","queue","ram","random","reboot","refresh","register",
  "render","repo","request","reset","resolution","resource","restore","robot","router","runtime",
  "sandbox","scanner","script","scroll","search","security","sensor","serial","server","session",
  "setup","shader","shell","shortcut","silicon","simulator","slider","slot","snapshot","software",
  "solid","sort","spam","spider","sprite","stack","startup","static","storage","struct",
  "subnet","suffix","supercomputer","syntax","tab","tag","tech","template","terabyte","test",
  "text","theme","thumbnail","timestamp","toolbar","tracker","traffic","transistor","transport","tuple",
  "type","ultra","unicast","unix","update","upload","uptime","url","user","utility",
  "variable","vendor","video","viewport","virtual","virus","visual","voltage","vpn","vram",
  "web","webpage","website","wiki","wireless","wizard","workflow","workstation","wrapper","xml",
  "yield","zigbee","zip"
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GenerateEmailRequest {
  installationId: string;
  realEmail: string;
  domain: string;
  url?: string;
  label?: string;
  description?: string;
  expiresInDays?: number;
}

interface BurnerEmail {
  id: string;
  email_address: string;
  installation_id: string;
  real_email: string;
  domain: string;
  url: string | null;
  label: string | null;
  description: string;
  is_active: boolean;
  expires_at: string | null;
  times_used: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Generates a random burner email address in the format: adjective-noun-NNNN@burner.privaseer.co.uk
 * With ~1000+ adjectives and ~1000+ nouns combined with 10,000 possible numbers,
 * this provides billions of unique combinations.
 */
function generateRandomEmail(): string {
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${randomAdjective}-${randomNoun}-${randomNum}@burner.privaseer.co.uk`;
}

denoRuntime.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  let authContext: { installationId: string; claims: jose.JWTPayload };
  try {
    authContext = await authenticateRequest(req);
  } catch (response) {
    if (response instanceof Response) {
      return response;
    }
    console.error("Authentication error:", response);
    return new Response(
      JSON.stringify({ error: "Authentication failed" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    if (!supabase) {
      throw new Error("Supabase client unavailable");
    }

    if (req.method === "POST") {
      const rawBody = await req.json();

      // Pass JWT's installationId to validation - no need to require it in body
      const validation = validateGenerateEmailRequest(rawBody, authContext.installationId);
      if (!validation.valid) {
        return createValidationErrorResponse(validation.error!);
      }

      const body = validation.sanitized!;
      // installationId now comes from JWT, so no mismatch check needed

      try {
        await enforceRateLimit(authContext.installationId);
      } catch (error) {
        if (error instanceof Response) {
          return error;
        }
        throw error;
      }

      let emailAddress = generateRandomEmail();
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        const { data: existing } = await supabase
          .from("burner_emails")
          .select("email_address")
          .eq("email_address", emailAddress)
          .maybeSingle();

        if (!existing) {
          break;
        }

        emailAddress = generateRandomEmail();
        attempts++;
      }

      if (attempts === maxAttempts) {
        return new Response(
          JSON.stringify({ error: "Failed to generate unique email" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      let expiresAt: string | null = null;
      if (body.expiresInDays && body.expiresInDays > 0) {
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + body.expiresInDays);
        expiresAt = expirationDate.toISOString();
      }

      const { data, error } = await supabase
        .from("burner_emails")
        .insert({
          installation_id: body.installationId,
          email_address: emailAddress,
          real_email: body.realEmail,
          domain: body.domain,
          url: body.url || null,
          label: body.label || null,
          description: body.description || '',
          is_active: true,
          expires_at: expiresAt,
          times_used: 0,
          last_used_at: null,
        })
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: "Failed to create burner email", details: error.message }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      await recordGeneration(authContext.installationId);

      return new Response(
        JSON.stringify({ success: true, email: data }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const installationId = url.searchParams.get("installationId");

      if (!installationId) {
        return new Response(
          JSON.stringify({ error: "Missing installationId" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (installationId !== authContext.installationId) {
        return new Response(
          JSON.stringify({ error: "Installation mismatch" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data, error } = await supabase
        .from("burner_emails")
        .select("*")
        .eq("installation_id", installationId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch burner emails" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true, emails: data }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const emailId = url.searchParams.get("emailId");
      const installationId = url.searchParams.get("installationId");

      if (!emailId || !installationId) {
        return new Response(
          JSON.stringify({ error: "Missing emailId or installationId" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (installationId !== authContext.installationId) {
        return new Response(
          JSON.stringify({ error: "Installation mismatch" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { error } = await supabase
        .from("burner_emails")
        .update({ is_active: false })
        .eq("id", emailId)
        .eq("installation_id", installationId);

      if (error) {
        return new Response(
          JSON.stringify({ error: "Failed to delete burner email" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
