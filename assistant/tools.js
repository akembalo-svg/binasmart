'use strict';
// Bini's hands. OpenAI-style function definitions (Gemini's OpenAI-compatible endpoint accepts them) and the
// executor that calls the app's own localhost API, so every limit, validation and side effect is the same one
// the web app and the MCP go through. Nothing here talks to the database except the tender search.
const ADDIS = { latMin: 8.5, latMax: 9.5, lngMin: 38.4, lngMax: 39.2 };
const TIERS = ['moto', 'bajaj', 'economy', 'comfort', 'xl'];

// Bini Browser (bina.et/agent): the Chrome side panel. Bini on the website and on Telegram takes the requests from
// offices and companies who want it (1 Oct 2026, for the Bini Browser ad). It is NOT free, so no price is ever quoted.
const AGENT_RE = /(bini ?browser|ቢኒ\s*(ብራውዘር|ብሮውዘር)|bina ?agent|ቢና\s*ኤጀንት|bina\.et\/agent|\bchrome\b|ክሮም|extension|ኤክስቴንሽን|\bbrowser\b|ብራውዘር|ብሮውዘር)/i;
const AGENT_FACTS = 'Bini Browser (https://bina.et/agent) is Bini inside Google Chrome on a computer: a side panel that does website work for the person - it reads the page, clicks, fills forms and finds information on sites such as eTrade, eGP, LMIS, MESOB (መሶብ), Fayda (ፋይዳ) and the immigration and passport portal (in Amharic: ኢሚግሬሽን፣ ፓስፖርት - never "ስደተኞች", which means refugees), in Amharic, Afaan Oromoo or English. The person opens Chrome and tells Bini the task. It never types passwords, PINs, one-time codes or card numbers (the person signs in themselves), it never pays, it asks before it submits or sends anything, and it says only what it saw on the pages. It is for government offices, companies and anyone who works on a computer. It is NOT free (it runs on paid AI): never say it is free and never quote a price - the team agrees it with each office or company and helps them set it up.';
const AGENT_ASK = 'If they want it for their office, company or themselves, ask in ONE message for what is missing: their name, the office or company name, whether it is a government office, a company or personal, their role, an Ethiopian phone number to call back and what work they want help with. Read it back, then call bini_browser_lead ONCE. Then tell them the team calls to set it up, usually within a day. If they only ask what it is, answer in a few lines and offer to take their details.';
const DEFS = [
  { name: 'search_places', description: 'Find a place in Addis Ababa by name (building, hotel, shop, landmark, area) and get its coordinates. Call this BEFORE quote_ride for any pickup or drop-off the user names. Returns up to 5 matches; pick the one that matches the user\'s words and confirm if two look alike.',
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'Place name in Amharic, English or Afaan Oromoo, e.g. "Bole Medhanialem", "መገናኛ", "Edna Mall"' } }, required: ['q'] } },
  { name: 'quote_ride', description: 'Fixed upfront BinaRide fare between two points in Addis Ababa, for every tier (moto, bajaj, economy, comfort, XL). Fares are locked at request time and never change with traffic. Use the exact numbers returned; never estimate.',
    parameters: { type: 'object', properties: {
      pickup: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } }, required: ['lat', 'lng'] },
      dropoff: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } }, required: ['lat', 'lng'] } }, required: ['pickup', 'dropoff'] } },
  { name: 'request_ride', description: 'Book a real BinaRide car. ONLY after the user has seen the fare from quote_ride and explicitly said yes to pickup, drop-off, tier, fare and their Ethiopian phone number in this conversation. Never call it to "check"; it sends a real driver. Returns the ride id and status.',
    parameters: { type: 'object', properties: {
      pickup: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } }, required: ['lat', 'lng'] },
      dropoff: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } }, required: ['lat', 'lng'] },
      tier: { type: 'string', enum: TIERS }, riderName: { type: 'string' }, riderPhone: { type: 'string', description: 'Ethiopian mobile, 09XXXXXXXX or +2519XXXXXXXX' },
      confirmed: { type: 'boolean', description: 'true only if the user explicitly confirmed fare, route, tier and phone' } }, required: ['pickup', 'dropoff', 'tier', 'riderPhone', 'confirmed'] } },
  { name: 'ride_status', description: 'Status of a ride (searching, assigned driver name/car/plate, arrived, on trip, completed, cancelled). Needs the ride id and the phone used to book.',
    parameters: { type: 'object', properties: { rideId: { type: 'string' }, phone: { type: 'string' } }, required: ['rideId', 'phone'] } },
  { name: 'pool_board', description: 'BinaPool (ጋራ ጉዞ / Imala Waliinii): corridors open right now with stops and the live seat-price ladder (1 to 4 riders), plus cars currently filling near a point if lat/lng are given. Use for any shared-ride or seat-price question.',
    parameters: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
  { name: 'cinema_programme', description: 'What is showing in Addis Ababa cinemas from today: venue, film, showtimes, dates. Data comes from the cinemas\' own programmes; if a film is not listed, say so.',
    parameters: { type: 'object', properties: { venue: { type: 'string', description: 'optional venue name filter' } } } },
  { name: 'search_tenders', description: 'Search verified Ethiopian tenders that are still open (deadline not passed): by keyword, organisation or category. Returns title, organisation, category, deadline and the bina.et link. It also holds AUCTIONS and disposal sales (banks selling property, used vehicles, scrap, equipment): for "auction", "ሐራጅ" or "ሽያጭ ጨረታ" pass q "auction" - never say there are no auctions without searching. Each result has its published date: for "new", "latest", "today" or "this week" pass newest true (today: only those published today), and never call a tender new or released today unless its published date says so.',
    parameters: { type: 'object', properties: { q: { type: 'string' }, category: { type: 'string' }, newest: { type: 'boolean', description: 'true for new / latest / today / this week: newest published first' } } } },
  { name: 'search_shops', description: 'Find a restaurant, cafe, pharmacy, bank, salon, gym, clinic or shop in Addis Ababa from the BinaSmart directory, with its page link, area and rating. Use whenever someone asks where to eat, where to buy something, for a recommendation, or for a business by name or kind. It also returns products and offers that shop owners posted on bina.et/shop (item, price, shop, area, phone): offer those when they fit, with the shop\'s phone so the buyer calls the shop directly (no commission). When the directory has no shop for a food or cafe question it returns mapPlaces from the city map (OpenStreetMap contributors): name, area, distance, map and ride links only, no phone, hours, prices or ratings - say so, and never call them BinaSmart partners. NEVER name a place or product this tool did not return.',
    parameters: { type: 'object', properties: {
      q: { type: 'string', description: 'Name or words to match, in Amharic or English, e.g. "Kaldi", "pizza", "Bole"' },
      category: { type: 'string', enum: ['RESTAURANT', 'CAFE', 'PHARMACY', 'BANK', 'SALON', 'GYM', 'CLINIC', 'RETAIL', 'SERVICE', 'OFFICE'], description: 'Kind of business' },
      limit: { type: 'number', description: 'How many to return, 1-10, default 6' } } } },
  { name: 'watch_channels', description: 'BinaWatch (bina.et/watch): live Ethiopian TV channels, FM radio stations (Sheger FM, etc.), series playlists and kids channels, each with a direct open link. Call it for any request to watch, listen, open, play a TV channel, radio station, series or drama; answer with the openUrl so the user taps once. Never send users to outside websites for TV or radio.',
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'channel, station or series name, e.g. "Sheger", "EBS", "ደራሽ"; empty = list all' }, kind: { type: 'string', enum: ['tv', 'radio', 'series', 'kids', 'all'] } } } },
  { name: 'search_jobs', description: 'Search open job vacancies in Ethiopia on BinaSmart (bina.et/jobs): by keyword, field of work or city. Returns the job title, the company, the city, the deadline and the bina.et link. Use it whenever someone asks about work, a vacancy, hiring, "ሥራ አለ?", or names a profession. Thousands of vacancies, refreshed every morning. Never invent a vacancy this tool did not return.',
    parameters: { type: 'object', properties: {
      q: { type: 'string', description: 'Keyword: a job title, a skill or a company, in Amharic or English' },
      field: { type: 'string', enum: ['banking', 'accounting', 'engineering', 'it', 'health', 'education', 'sales', 'ngo', 'logistics', 'admin', 'hospitality', 'construction', 'agriculture', 'legal', 'security', 'media'], description: 'Field of work' },
      city: { type: 'string', description: 'City, e.g. Addis Ababa, Adama, Hawassa' },
      limit: { type: 'number', description: 'How many to return, 1-10, default 6' } } } },
  { name: 'search_properties', description: 'Search homes, apartments, condominiums, villas, land and shops/offices for SALE or RENT on BinaSmart (bina.et/property). The listings come from real-estate companies\' own websites and are checked every week. Returns the title, price, bedrooms, size, area, the listing company with ITS OWN phone and WhatsApp, and a bina.et link that opens that listing. Use it whenever someone wants to buy or rent a place to live or work: "house for rent", "2 bedroom apartment", "condo", "villa", "land", "office for rent", "ቤት", "ኪራይ", "አፓርትመንት", "ኮንዶሚኒየም". Never invent a listing, price, phone or company this tool did not return.',
    parameters: { type: 'object', properties: {
      listing: { type: 'string', enum: ['sale', 'rent'], description: 'Buy (sale) or rent' },
      type: { type: 'string', enum: ['Apartment', 'Condominium', 'House / Villa', 'Land', 'Commercial', 'Building'], description: 'Kind of property' },
      area: { type: 'string', description: 'Neighbourhood in English letters, e.g. Bole, Sarbet, CMC, Ayat, Kazanchis, Megenagna' },
      beds: { type: 'number', description: 'At least this many bedrooms (0 = studio)' },
      maxPrice: { type: 'number', description: 'Highest price in birr: the total for a sale, per month for a rent' },
      q: { type: 'string', description: 'Other words: a building, project or company name' },
      limit: { type: 'number', description: 'How many to return, 1-8, default 5' } } } },
  { name: 'search_cars', description: 'Search cars for SALE on BinaSmart (bina.et/cars): new and used cars from Addis Ababa dealers\' and car markets\' own websites, checked every week. Returns make, model, year, price, mileage, fuel, gearbox, the dealer with ITS OWN phone and WhatsApp, and a bina.et link to the car. Use it whenever someone wants to buy a car or asks what a car costs: "used Toyota", "SUV for sale", "electric car price", "BYD", "የሚሸጥ መኪና", "መኪና መግዛት". Not for taxi rides (quote_ride). Never invent a car, price, phone or dealer this tool did not return.',
    parameters: { type: 'object', properties: {
      make: { type: 'string', description: 'Brand, e.g. Toyota, Suzuki, BYD, Hyundai, Nissan' },
      model: { type: 'string', description: 'Model, e.g. Corolla, Vitara, Seagull, Tucson' },
      where: { type: 'string', enum: ['addis', 'china'], description: 'addis = cars already in Addis Ababa; china = electric cars in China that Jedda Star imports to order. Leave empty for both.' },
      body: { type: 'string', enum: ['SUV', 'Sedan', 'Hatchback', 'Pickup', 'Van / Bus', 'Truck', 'EV'], description: 'Body type' },
      fuel: { type: 'string', enum: ['Petrol', 'Diesel', 'Hybrid', 'Electric'], description: 'Fuel' },
      transmission: { type: 'string', enum: ['Automatic', 'Manual'] },
      condition: { type: 'string', enum: ['New', 'Used'] },
      minYear: { type: 'number', description: 'Only cars from this year or newer' },
      maxPrice: { type: 'number', description: 'Highest price in birr' },
      q: { type: 'string', description: 'Other words' },
      sort: { type: 'string', enum: ['cheap'], description: 'cheap = cheapest first' },
      limit: { type: 'number', description: 'How many to return, 1-8, default 5' } } } },
  { name: 'search_hotels', description: 'Find hotels, guest houses, pensions, hostels, motels and furnished apartments in Addis Ababa from BinaSmart\'s hotel directory (1,000+ places from the city map). Returns the name, type, area (sub-city), stars, the hotel\'s own office phone and website, and its bina.et page. It has NO prices and no room availability: say so and tell the guest to call the hotel. Use it for "hotel in Bole", "cheap guest house near Piassa", "4 star hotel", "ሆቴል", "ፔንሲዮን", "እንግዳ ማረፊያ". For a ride TO a hotel use search_places + quote_ride. Never invent a hotel, price or phone.',
    parameters: { type: 'object', properties: {
      area: { type: 'string', description: 'Sub-city or area in English or Amharic, e.g. Bole, Kirkos, Arada, Yeka, ቦሌ' },
      kind: { type: 'string', enum: ['hotel', 'guest_house', 'hostel', 'motel', 'apartment'], description: 'guest_house also covers pensions' },
      minStars: { type: 'number', description: 'At least this many stars (1-5)' },
      q: { type: 'string', description: 'Part of the hotel name' },
      limit: { type: 'number', description: 'How many to return, 1-10, default 6' } } } },
  { name: 'post_job', description: 'Send an employer\'s vacancy to BinaSmart to be published, free. Use ONLY when someone says they want to advertise a job they are hiring for. It does NOT publish: the vacancy goes to the BinaSmart team, a person checks it, and it appears on bina.et within a few hours. Tell the user exactly that - never tell them it is live. Collect the company name and the job title first (both required), and ask for the city, how to apply and a short description before calling. If the person cannot give a company name, do not call this tool.',
    parameters: { type: 'object', required: ['employerName', 'title'], properties: {
      employerName: { type: 'string', description: 'The hiring company, as the employer gives it' },
      title: { type: 'string', description: 'The job title' },
      city: { type: 'string' },
      jobType: { type: 'string', enum: ['full-time', 'part-time', 'contract', 'internship', 'temporary'] },
      salary: { type: 'string', description: 'Only if the employer states one' },
      deadline: { type: 'string', description: 'Closing date, YYYY-MM-DD, only if stated' },
      summary: { type: 'string', description: 'One or two lines about the job' },
      bodyHtml: { type: 'string', description: 'Duties, requirements and experience, in the employer\'s own words' },
      howToApply: { type: 'string', description: 'Email, office address or application link' },
      submitter: { type: 'string', description: 'Who is posting it, if they say' } } } },
  // 24 September 2026: 128 people had 5,848 conversations with Bini and 2 of them ever subscribed to a
  // job alert. The product existed; nothing ever offered it. A person asking about work is exactly the
  // person who wants to hear when the next one opens, and asking them costs one sentence.
  { name: 'job_alert', description: 'Subscribe this person to a daily alert for new vacancies in a field of work, or stop one, or list what they get. OFFER THIS whenever someone asks about jobs, says they are looking for work, or searches a field and finds nothing today - one short question, "shall I tell you when a new one opens?", and set it up if they say yes. Telegram only: it has nowhere to send to on the website, and the tool will say so.',
    parameters: { type: 'object', required: ['action'], properties: {
      action: { type: 'string', enum: ['subscribe', 'stop', 'list'] },
      field: { type: 'string', enum: ['all', 'banking', 'accounting', 'engineering', 'it', 'health', 'education', 'sales', 'ngo', 'logistics', 'admin', 'hospitality', 'construction', 'agriculture', 'legal', 'security', 'media'], description: 'Field of work, or "all" for every new vacancy. Required to subscribe or stop.' },
      city: { type: 'string', description: 'Only if they name one, e.g. Addis Ababa, Adama' } } } },
  // bina.et/health (30 Sep 2026): Bini answered health-place questions from the map chunks in her knowledge and linked
  // OpenStreetMap, never the directory, and a parent asking for a hospital open at night got a paragraph about the
  // Ministry's service package and no hospital at all. This tool is the directory itself.
  { name: 'search_health', description: 'Find hospitals, clinics, dentists, laboratories, health centres and doctors in Addis Ababa from BinaSmart Health (bina.et/health: 250+ places from the city map, plus the services and doctors that facilities confirmed themselves). Returns each place\'s bina.et/health page, its landline, sub-city, distance when you give an area, and its services and doctors when known. Use it for "dentist in Bole", "hospital near Piassa", "children\'s clinic", "lab for a blood test", "gynecologist", "ሆስፒታል", "ክሊኒክ", "የጥርስ ሐኪም", "ላብራቶሪ", "የህፃናት ሐኪም". For someone who is unwell, search by kind and area WITHOUT q so the NEAREST places come first; add q only when they ask for a specialist or a specialty. Give the bina.et/health link of every place you name. Opening hours and night service are unknown unless "hours" is given: say so and tell them to call first. You never diagnose or recommend treatment: name the KIND of place that fits, and say Dr Afiya (https://bina.et/afiya) can explain which department to go to; anything urgent: call 907. For a ride TO a hospital use search_places + quote_ride. A doctor, clinic or hospital that wants to be listed joins free at https://bina.et/health?join=doctor or https://bina.et/health?join=facility (not company_request). Never invent a place, a phone or a doctor.',
    parameters: { type: 'object', properties: {
      kind: { type: 'string', enum: ['hospital', 'clinic', 'dentist', 'lab', 'doctor'], description: 'lab = laboratory or diagnostic centre; doctor = individual doctors\' profiles. Leave out when any kind will do.' },
      area: { type: 'string', description: 'A sub-city or a neighbourhood or landmark, English or Amharic: Bole, Kirkos, Arada, Piassa, CMC, Megenagna, ቦሌ, ፒያሳ. A neighbourhood gives the nearest places first.' },
      q: { type: 'string', description: 'A specialty, a service or part of the name: children, gynecology, eye, heart, bone, fertility, skin, mental health, blood test, Hayat' },
      limit: { type: 'number', description: '1-10, default 6' },
    } } },
  { name: 'remember', description: 'Save something about this user for next time: their name, phone, preferred language, home or work place, or a short note. For home/work pass the place NAME as value; this tool finds the coordinates itself, so do NOT call search_places first. Call it whenever the user says "remember", "my name is", "my home is", "my work is", "ቤቴ … ነው", "ስሜ … ነው", "manni koo …" — one call per fact.',
    parameters: { type: 'object', properties: { field: { type: 'string', enum: ['name', 'phone', 'lang', 'home', 'work', 'notes'] }, value: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }, required: ['field', 'value'] } },
  { name: 'company_request', description: 'For a person who works at a company or a hotel listed on BinaSmart (a real estate company, a car dealer, or a hotel, guest house, pension or furnished apartment): send their request to the BinaSmart team for approval. Use it to add or change their phone or WhatsApp number, correct details, add homes or cars, add hotel rooms and prices, add a restaurant\'s hours and dishes with prices, remove a listing, or confirm (claim) their page. For a hotel pass kind "hotel"; for a restaurant, cafe or fast-food place on bina.et/restaurants pass kind "restaurant". Call it once, after you have the company, the person\'s name, their role, a phone number to call back, and exactly what they want. Nothing goes live until the team approves it. Never use it for a question about BinaSmart itself (driver commission, BinaSmart prices, jobs, how the app works): answer that, or use contact_team. Not for a hospital, clinic, dentist, lab or doctor: they join BinaSmart Health free at https://bina.et/health?join=facility or https://bina.et/health?join=doctor, where Dr Afiya asks the questions and the team checks the licence.',
    parameters: { type: 'object', properties: { company: { type: 'string', description: 'page slug (e.g. temer-properties, or a hotel slug from bina.et/hotels/<slug>) or the company or hotel name' }, kind: { type: 'string', enum: ['company', 'hotel', 'restaurant'] }, name: { type: 'string', description: 'the person\'s name' }, role: { type: 'string', enum: ['owner', 'manager', 'staff'] }, phone: { type: 'string', description: 'Ethiopian phone number to call back, e.g. 0900 000 012' }, request: { type: 'string', description: 'exactly what to add, change or remove, with any numbers or listing details they gave' },
      rooms: { type: 'array', description: 'for a hotel that gives room prices: each room type and its price per night, exactly as they said', items: { type: 'object', properties: { name: { type: 'string', description: 'e.g. Standard double, with breakfast' }, price: { type: 'number' }, currency: { type: 'string', enum: ['ETB', 'USD'] } }, required: ['name', 'price'] } },
      dishes: { type: 'array', description: 'for a restaurant that gives dishes: each dish and its price, exactly as they said', items: { type: 'object', properties: { name: { type: 'string', description: 'e.g. Special kitfo' }, price: { type: 'string', description: 'e.g. 450 birr' } }, required: ['name'] } },
      hours: { type: 'string', description: 'for a restaurant: opening hours as they said them' }, publicPhone: { type: 'string', description: 'for a restaurant: the number customers should call, if they want one shown' } }, required: ['company', 'name', 'phone', 'request'] } },
  { name: 'listing_request', description: 'For a person who wants to SELL or RENT OUT a home, apartment, condominium, villa, G+ building, land, shop, office, warehouse or room in Ethiopia: a private owner, an agent (delala) or a company. Listing is FREE, no commission; buyers and tenants call or WhatsApp the person directly. Collect, one or two questions at a time: sale or rent, property type, area / neighbourhood, price (monthly rent for rent), bedrooms, bathrooms and size when it is a home, a short description, their name, their phone number, whether that number may be shown with WhatsApp, and whether they are the owner, an agent or a company (and the company name). Offer photos once (on the website they tap the camera button in this chat); photos are OPTIONAL: if they have none or say send / submit / ላከው, do not wait. Then call it ONCE with action "add". Nothing is public yet: the team calls them to confirm, then approves, usually within a day. For a new price or other change call it with action "change", for "it is sold / rented, take it down" with action "remove"; pass the listing link or title and exactly what to change. Never invent details the person did not give. Never use it to search for a home (use search_properties).',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'change', 'remove'] }, listing_type: { type: 'string', enum: ['sale', 'rent'] },
      property_type: { type: 'string', enum: ['villa', 'house', 'apartment', 'condominium', 'g_plus', 'land', 'shop', 'office', 'warehouse', 'room'] },
      location: { type: 'string', description: 'area or neighbourhood, e.g. Bole, CMC, Ayat, Summit' }, price: { type: 'string', description: 'price in birr as they said it, e.g. "12,000,000 birr" or "35,000 birr per month"' },
      beds: { type: 'string' }, baths: { type: 'string' }, size: { type: 'string', description: 'e.g. "180 m2" or "300 kare"' }, description: { type: 'string', description: 'short description in their words' },
      name: { type: 'string' }, role: { type: 'string', enum: ['owner', 'agent', 'company'] }, company: { type: 'string', description: 'company name when role is company or agent works for one' },
      phone: { type: 'string', description: 'Ethiopian phone, e.g. 0900 000 012' }, whatsapp: { type: 'boolean', description: 'true if buyers may WhatsApp this number' },
      listing: { type: 'string', description: 'for change/remove: the bina.et/property link or the title' }, request: { type: 'string', description: 'for change/remove: exactly what to change' } }, required: ['action', 'name', 'phone'] } },
  { name: 'shop_post', description: 'For a shop owner or seller in Addis Ababa who wants to POST a product or an offer / discount on bina.et/shop (free, no commission; buyers call the shop directly), or to change or take down their post. Collect the shop name (their own name if they sell alone) and area, the item name, its price in birr, the person\'s name and an Ethiopian phone for buyers; ask for everything missing in one message. Work out the category yourself; WhatsApp is on unless they say no. Photos are optional: on the website they tap the camera button in this chat; never wait for photos. Read the facts back, then call it ONCE with action "add". Nothing is public yet: the team calls them to confirm, then approves, usually within a day. Refuse medicines, weapons, alcohol, tobacco, counterfeit or adult items. Never invent details the person did not give. Never use it to find a shop (use search_shops).',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'change', 'remove'] },
      shop: { type: 'string', description: 'the shop name' }, area: { type: 'string', description: 'area or building, e.g. Bole, Merkato, Piassa, Edna Mall' },
      kind: { type: 'string', enum: ['product', 'offer'] }, title: { type: 'string', description: 'what is for sale, e.g. "Samsung Galaxy A15, 128 GB"' },
      price: { type: 'string', description: 'the price as they said it, e.g. "18,500 birr"; for an offer, the offer price or the discount' },
      category: { type: 'string', enum: ['fashion', 'shoes', 'electronics', 'phones', 'beauty', 'food', 'home', 'kids', 'books', 'other'] },
      description: { type: 'string', description: 'one or two short sentences: size, colour, condition, brand' },
      name: { type: 'string', description: 'the person\'s name' }, phone: { type: 'string', description: 'Ethiopian phone for buyers, e.g. 0900 000 012' },
      whatsapp: { type: 'boolean', description: 'false only if they say buyers must not WhatsApp that number' },
      post: { type: 'string', description: 'for change / remove: which post (its item name)' }, request: { type: 'string', description: 'for change / remove: exactly what to change' } },
      required: ['action', 'name', 'phone'] } },
  { name: 'bini_browser_lead', description: 'Send a Bini Browser request to the BinaSmart team, for a person who wants Bini Browser for their government office, their company or themselves. ' + AGENT_FACTS + ' ' + AGENT_ASK + ' Never invent details the person did not give. Not for questions about the bina.et website or other BinaSmart services.',
    parameters: { type: 'object', properties: {
      name: { type: 'string', description: 'the person\'s name' },
      organisation: { type: 'string', description: 'the office or company name; "personal" if it is just for them' },
      kind: { type: 'string', enum: ['government', 'company', 'personal', 'other'] },
      role: { type: 'string', description: 'their role or position, if they said' },
      phone: { type: 'string', description: 'Ethiopian phone number to call back' },
      need: { type: 'string', description: 'what website work they want Bini Browser to help with' },
      computers: { type: 'string', description: 'how many people or computers, if they said' } },
      required: ['name', 'organisation', 'phone', 'need'] } },
  { name: 'contact_team', description: 'Hand the conversation to the BinaSmart team (a person) with a short summary, when the user asks for a human, has a complaint you cannot resolve, or needs something only the team can do (pricing for businesses, a refund, a partner request). Tell the user the team will reply on this chat or on WhatsApp.',
    parameters: { type: 'object', properties: { summary: { type: 'string' }, reason: { type: 'string' } }, required: ['summary'] } },
];

const toOpenAI = () => DEFS.map(d => ({ type: 'function', function: d }));

const HEALTH_SUBCITY = /^(bole|kirkos|arada|yeka|gulele|lideta|addis ketema|akaki|kality|kaliti|akaki kality|kolfe|kolfe keranio|nifas silk|nifas silk-lafto|lemi kura|ቦሌ|ቂርቆስ|አራዳ|የካ|ጉለሌ|ልደታ|አዲስ ከተማ|አቃቂ|ቃሊቲ|ኮልፌ|ንፋስ ስልክ|ለሚ ኩራ)(\s*(sub.?city|ክፍለ ከተማ|ክ\/ከተማ))?$/i;
const { FOOD_RE, findFood, NOTE: FOOD_NOTE } = require('./food-map');   // the city-map fallback for food (also /api/places/food and the MCP)
function inAddis(p) { return p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && +p.lat >= ADDIS.latMin && +p.lat <= ADDIS.latMax && +p.lng >= ADDIS.lngMin && +p.lng <= ADDIS.lngMax; }
const clean = p => ({ lat: +p.lat, lng: +p.lng, label: String(p.label || '').slice(0, 80) });
// The model sometimes FLATTENS the two points (pickup_lat, pickup_lng, dropoff_lat, ...): measured 30 Sep 2026 on
// "take me to Hayat Hospital from Bole Medhanialem", where both points were found and every fare still failed as
// "not inside Addis". Both shapes mean the same point.
const point = (a, k) => (a && a[k] && typeof a[k] === 'object') ? a[k]
  : (a && a[k + '_lat'] != null && a[k + '_lng'] != null ? { lat: a[k + '_lat'], lng: a[k + '_lng'], label: a[k + '_label'] || a[k + '_name'] || '' } : (a || {})[k]);

// Ride points the model did not get from us are guesses. Measured 30 Sep 2026: after a Bole -> Piassa quote (bajaj
// 185 ETB), "and with bajaj?" re-quoted with invented coordinates and answered 170, 175 or 195 ETB. The history the
// model sees is text, so a second turn has no coordinates to reuse. A point stands when it lies within 150 m of a
// place we gave this conversation (search_places, the last quoted trip, a remembered place). Otherwise its label is
// matched to one of those places (the last trip first), then looked up on our own map. A map result is used only when
// every word of the label is in its name, or it lies within 2 km of the guess. Nothing matches: the guess stands, as before.
// "Bole" snaps to "Bole Medhanialem"; "Bole Airport" never snaps to a plain "Bole".
// Our own map has several points with one name (three "Bole", two "Piassa" on 30 Sep 2026), so a follow-up that
// searched again could pick another one and get another fare (185 vs 190 ETB). The last quoted trip therefore wins
// over any other point with the same name within 1.5 km: the same name in the same area is the same place.
const RECENT = new Map();   // conversation key (ctx.ip) -> { t, trip: [pickup, dropoff], seen: [places] }
const RECENT_TTL_MS = 3 * 3600 * 1000, RECENT_MAX = 5000, NEAR_M = 150, GUESS_M = 2000, SAME_PLACE_M = 1500;
function distM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const hasXY = p => !!p && p.lat != null && p.lng != null && Number.isFinite(+p.lat) && Number.isFinite(+p.lng);
const normName = v => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// every word of the label is in the place's name (the label is the same or less specific), in English or Amharic
function nameFits(label, ...names) {
  const want = normName(label).split(' ').filter(Boolean); if (want.join('').length < 3) return false;
  return names.some(n => { const have = new Set(normName(n).split(' ').filter(Boolean)); return have.size > 0 && want.every(w => have.has(w)); });
}
const nearest = (list, g) => !hasXY(g) ? list[0] : list.slice().sort((x, y) => distM(x, g) - distM(y, g))[0];

// executor factory. ctx: { base, fetchImpl, prisma, memory, user, ip, handover, log }
function makeExecutor(ctx) {
  const f = ctx.fetchImpl || fetch;
  async function api(method, path, body, phone) {
    const r = await f(ctx.base + path, { method, headers: { 'content-type': 'application/json', 'x-real-ip': phone ? 'bini-' + String(phone).replace(/\D/g, '').slice(-9) : (ctx.ip || 'bini') }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (d && d.error) || ('http_' + r.status) };
    return d;
  }
  // Grounding state lives per conversation (ctx.ip is 'bini-' + the user key) so the next request can reuse the trip.
  const convKey = ctx.ip ? String(ctx.ip) : null, local = { t: 0, trip: [], seen: [] };
  function recent() {
    if (!convKey) return local;
    let st = RECENT.get(convKey);
    if (!st || Date.now() - st.t > RECENT_TTL_MS) {
      st = { t: 0, trip: [], seen: [] }; RECENT.delete(convKey); RECENT.set(convKey, st);
      if (RECENT.size > RECENT_MAX) RECENT.delete(RECENT.keys().next().value);
    }
    st.t = Date.now(); return st;
  }
  async function ground(p) {
    const g = p && typeof p === 'object' ? p : {}, label = String(g.label || g.name || '').trim(), xy = hasXY(g);
    const st = recent(), mem = [];
    try {
      const u = ctx.memory && typeof ctx.memory.get === 'function' ? await ctx.memory.get() : null;
      for (const k of ['lastPickup', 'lastDropoff', 'home', 'work']) if (u && hasXY(u[k])) mem.push({ lat: +u[k].lat, lng: +u[k].lng, label: u[k].label || '' });
    } catch (e) { /* memory is a bonus, never a failure */ }
    const known = [...st.trip, ...mem, ...st.seen];
    const G = xy ? { lat: +g.lat, lng: +g.lng } : null;
    const trip = label ? st.trip.find(k => nameFits(label, k.label)) : null;
    if (trip && (!G || distM(trip, G) <= SAME_PLACE_M)) return { lat: trip.lat, lng: trip.lng, label: trip.label || label };
    if (G && known.some(k => distM(k, G) <= NEAR_M)) return g;
    if (!label) return g;
    const mine = trip || nearest([...mem, ...st.seen].filter(k => nameFits(label, k.label, k.nameAm)), G);
    if (mine) return { lat: mine.lat, lng: mine.lng, label: mine.label || label };
    const d = await api('GET', '/api/ride/search?q=' + encodeURIComponent(label.slice(0, 80)));
    const hits = ((d && d.results) || []).filter(inAddis).map(h => ({ lat: +h.lat, lng: +h.lng, label: h.label || h.name || '', nameAm: h.labelAm || '' }));
    const hit = nearest(hits.filter(h => nameFits(label, h.label, h.nameAm)), G) || (G && hits[0] && distM(hits[0], G) <= GUESS_M ? hits[0] : null);
    return hit ? { lat: hit.lat, lng: hit.lng, label: hit.label || label } : g;
  }
  const mapFood = (term, category, base) => findFood(term, category, { gazetteer: ctx.gazetteer, fetchImpl: f, base });
  const H = {
    async search_places({ q }) {
      const d = await api('GET', '/api/ride/search?q=' + encodeURIComponent(String(q || '').slice(0, 80)));
      if (d.error) return d;
      const results = (d.results || []).slice(0, 5).map(p => ({ name: p.label || p.name, nameAm: p.labelAm || null, kind: p.kind, lat: p.lat, lng: p.lng, area: p.sub || '' }));
      const st = recent(); for (const r of results) if (hasXY(r)) st.seen.push({ lat: +r.lat, lng: +r.lng, label: r.name || '', nameAm: r.nameAm || '' });
      if (st.seen.length > 40) st.seen.splice(0, st.seen.length - 40);
      return { results };
    },
    async quote_ride(a) {
      const pickup = await ground(point(a, 'pickup')), dropoff = await ground(point(a, 'dropoff'));
      if (!inAddis(pickup) || !inAddis(dropoff)) return { error: 'pickup and dropoff must be inside Addis Ababa; use search_places first' };
      const d = await api('POST', '/api/ride/quote', { pickup: clean(pickup), dropoff: clean(dropoff) });
      if (d.error) return d;
      recent().trip = [clean(pickup), clean(dropoff)];
      if (ctx.memory) ctx.memory.touch({ lastPickup: clean(pickup), lastDropoff: clean(dropoff) }).catch(() => {});
      return { from: clean(pickup).label, to: clean(dropoff).label, distanceKm: +(d.distanceM / 1000).toFixed(1), minutes: Math.round(d.durationS / 60), fares: (d.quotes || []).map(q => ({ tier: q.tier, label: q.label, labelAm: q.labelAm, seats: q.seats, etb: q.fareEtb != null ? q.fareEtb : (q.fare != null ? q.fare : q.etb) })), note: 'Fixed fares, locked at booking; cash to the driver.' };
    },
    async request_ride(a) {
      const { tier, riderName, riderPhone, confirmed } = a || {};
      if (!confirmed) return { error: 'not_confirmed: ask the user to confirm fare, route, tier and phone first' };
      const pickup = await ground(point(a, 'pickup')), dropoff = await ground(point(a, 'dropoff'));
      if (!inAddis(pickup) || !inAddis(dropoff)) return { error: 'pickup and dropoff must be inside Addis Ababa' };
      if (!TIERS.includes(tier)) return { error: 'tier must be one of ' + TIERS.join(', ') };
      const ph = String(riderPhone || '').replace(/[^\d+]/g, '');
      if (!/^(\+?251|0)9\d{8}$/.test(ph)) return { error: 'riderPhone must be an Ethiopian mobile (09XXXXXXXX)' };
      // An evaluation takes the real path up to here (checks and grounding included) but never books: a request is a
      // real ride in the concierge queue and a message to the team. Found 30 Sep 2026: shop_post and company_request
      // had this guard, request_ride did not (no evaluation had booked yet).
      if (ctx.dryRun) return { ok: true, dryRun: true, rideId: 'eval-dry-run', status: 'searching', wouldSend: { pickup: clean(pickup), dropoff: clean(dropoff), tier, riderPhone: ph },
        note: 'Evaluation run, no ride was requested. Otherwise answer exactly as if it was booked.' };
      const d = await api('POST', '/api/ride/request', { pickup: clean(pickup), dropoff: clean(dropoff), tier, riderName: String(riderName || (ctx.user && ctx.user.name) || 'Bini rider').slice(0, 60), riderPhone: ph, paymentMethod: 'cash', source: 'bini' }, ph);
      if (d.error) return d;
      if (ctx.memory) ctx.memory.touch({ phone: ph, name: riderName || undefined }).catch(() => {});
      const r = d.ride || d;
      return { rideId: r.id, status: r.status, fareEtb: r.fareEtb || r.fare, trackUrl: (ctx.publicBase || 'https://bina.et') + '/ride?id=' + r.id, note: 'Tell the user the ride id and that the driver name, car and plate will appear on the tracking link and on Telegram.' };
    },
    async ride_status({ rideId, phone }) {
      // A ride id is a lowercase code from the ride link (c + 24 letters/digits). 1 Oct 2026, a real person sent
      // "essc/2084/261001/3" and heard "I can't find a ride with that ID": it was some other reference number.
      const raw = String(rideId || '').trim(), inLink = /(?:id=)?\b(c[a-z0-9]{20,30})\b/.exec(raw);
      const id = inLink ? inLink[1] : /^[a-z0-9]{1,30}$/.test(raw) ? raw : null;
      if (!id) return { error: 'not_a_ride_id', note: 'This is not a BinaSmart ride id (those come from the ride link, like bina.et/ride?id=c…). Do not say a ride was not found: ask what this number is for and help with that.' };
      const d = await api('GET', '/api/ride/' + encodeURIComponent(id) + '?phone=' + encodeURIComponent(String(phone || '')));
      if (d.error) return d;
      const r = d.ride || {};
      return { status: r.status, driver: r.driver ? { name: r.driver.name, car: r.driver.car || r.driver.vehicle, plate: r.driver.plate, phone: r.driver.phone } : null, fareEtb: r.fareEtb, pickup: r.pickup && r.pickup.label, dropoff: r.dropoff && r.dropoff.label };
    },
    async pool_board({ lat, lng }) {
      const qs = (Number.isFinite(+lat) && Number.isFinite(+lng)) ? '?lat=' + (+lat) + '&lng=' + (+lng) : '';
      const d = await api('GET', '/api/pool/board' + qs);
      if (d.error) return d;
      return { direction: d.direction, peak: d.peak, corridors: (d.corridors || []).map(c => ({ name: c.name, nameAm: c.nameAm, stops: (c.stops || []).map(s => s.label), seatPrices: (c.ladder || []).map(l => ({ riders: l.n, seatEtb: l.seatEtb })), filling: c.open || c.filling || null })), nearby: (d.groups || []).map(g => ({ id: g.id, to: g.destLabel || g.to || g.name, seatsLeft: g.seatsLeft, seatEtb: g.seatEtb || g.seatFareEtb, womenOnly: !!g.womenOnly, joinUrl: (ctx.publicBase || 'https://bina.et') + '/pool/' + g.id })), joinUrl: (ctx.publicBase || 'https://bina.et') + '/ride?pool=1' };
    },
    async cinema_programme({ venue }) {
      const d = await api('GET', '/api/cinema/programme');
      if (d.error) return d;
      let venues = d.venues || [];
      if (venue) { const v = String(venue).toLowerCase(); venues = venues.filter(x => (x.venue.name + ' ' + (x.venue.nameAm || '') + ' ' + (x.venue.area || '')).toLowerCase().includes(v)); }
      return { today: d.today, venues: venues.slice(0, 8).map(x => ({ venue: x.venue.name, area: x.venue.area, films: (x.films || []).slice(0, 8).map(p => ({ title: p.title, titleAm: p.titleAm, times: p.times, from: p.dateFrom, to: p.dateTo, hall: p.hallName })) })), bookUrl: (ctx.publicBase || 'https://bina.et') + '/cinema' };
    },
    async search_tenders({ q, category, newest }) {
      if (!ctx.prisma) return { error: 'tenders unavailable' };
      // "Tenders released today" (1 Oct 2026) got the six that close soonest, published 16-23 Sep, called "released today",
      // while 10 were published that day. Recency words ask for the newest; "today" means since midnight in Addis (UTC+3).
      const RECENT = /\b(today|todays|new|newest|latest|recent|recently|this week|released|just)\b|ዛሬ|አዲስ|የቅርብ|በቅርቡ/gi;
      const raw = String(q || '').trim().slice(0, 60), wantsToday = /\btoday\b|ዛሬ/i.test(raw);
      const recent = newest === true || /\b(today|todays|new|newest|latest|recent|recently|this week|released|just)\b|ዛሬ|አዲስ|የቅርብ|በቅርቡ/i.test(raw);
      const term = raw.replace(RECENT, ' ').replace(/\b(tenders?|bids?)\b|ጨረታዎች|ጨረታ/gi, ' ').replace(/\s+/g, ' ').trim();
      const where = { published: true, OR: [{ deadline: null }, { deadline: { gte: new Date() } }] };
      if (wantsToday) { const n = new Date(Date.now() + 3 * 3600000); where.publishedAt = { gte: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - 3 * 3600000) }; }
      if (category) where.category = { contains: String(category).slice(0, 40), mode: 'insensitive' };
      // An auction is a kind of notice, not a word in every title: "Auction" was answered "I don't have information about
      // auctions" on 28 Sep 2026 while 11 auctions were open. Any auction word searches the whole sales-and-disposal kind.
      if (/auction|ሐራጅ|ሃራጅ|ሽያጭ ጨረታ|dispos/i.test(term)) where.AND = [{ OR: [{ title: { contains: 'auction', mode: 'insensitive' } }, { title: { contains: 'dispos', mode: 'insensitive' } },
        { titleAm: { contains: 'ሐራጅ' } }, { titleAm: { contains: 'ሽያጭ' } }, { category: { contains: 'dispos', mode: 'insensitive' } }] }];
      else if (term) where.AND = [{ OR: [{ title: { contains: term, mode: 'insensitive' } }, { titleAm: { contains: term, mode: 'insensitive' } }, { org: { contains: term, mode: 'insensitive' } }, { summary: { contains: term, mode: 'insensitive' } }] }];
      const rows = await ctx.prisma.tender.findMany({ where, orderBy: recent ? [{ publishedAt: 'desc' }] : [{ deadline: { sort: 'asc', nulls: 'last' } }], take: 6 });
      // the whole count for "today", so a list of 6 is not read as "6 tenders today" (10 were)
      const total = wantsToday && ctx.prisma.tender.count ? await ctx.prisma.tender.count({ where }).catch(() => null) : null;
      return { count: rows.length, total: total != null ? total : undefined, note: total != null && total > rows.length ? 'Showing ' + rows.length + ' of ' + total + ' published today; the full list is on https://bina.et/tenders' : undefined,
        order: recent ? (wantsToday ? 'published today, newest first' : 'newest published first') : 'closing soonest first', tenders: rows.map(t => ({ title: t.titleAm || t.title, org: t.org, category: t.category, region: t.region, published: t.publishedAt ? t.publishedAt.toISOString().slice(0, 10) : null, deadline: t.deadline ? t.deadline.toISOString().slice(0, 10) : null, url: (ctx.publicBase || 'https://bina.et') + '/tenders/' + t.slug })), allUrl: (ctx.publicBase || 'https://bina.et') + '/tenders' };
    },
    async search_shops({ q, category, limit }) {
      if (!ctx.prisma) return { error: 'directory unavailable' };
      const term = String(q || '').trim().slice(0, 60);
      const where = { status: 'live', NOT: { slug: null } };
      if (category) where.category = String(category).toUpperCase().slice(0, 20);
      if (term) where.OR = [{ name: { contains: term, mode: 'insensitive' } }, { nameAm: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } }, { address: { contains: term, mode: 'insensitive' } }];
      const rows = await ctx.prisma.shop.findMany({ where,
        orderBy: [{ featured: 'desc' }, { reviewCount: 'desc' }, { avgRating: 'desc' }],
        take: Math.max(1, Math.min(Number(limit) || 6, 10)),
        select: { name: true, nameAm: true, category: true, address: true, phone: true, avgRating: true, reviewCount: true, isOpenNow: true, slug: true } });
      const base = ctx.publicBase || 'https://bina.et';
      let posts = [];                 // products shop owners posted on bina.et/shop (approved only)
      try { posts = require('../shops/posts').searchLive(term, 4).map(p => ({ item: p.title, kind: p.kind, price: p.price, shop: p.shop, area: p.area,
        phone: p.phone, whatsapp: p.whatsapp, url: p.url })); } catch (e) { posts = []; }
      const out = { count: rows.length + posts.length, posts, shops: rows.map(s => ({
        name: s.nameAm || s.name, category: s.category, area: s.address || null, phone: s.phone || null,
        // a rating with no reviews behind it is noise, and Bini must not quote one
        rating: s.reviewCount > 0 ? s.avgRating : null, reviews: s.reviewCount, openNow: s.isOpenNow,
        url: base + '/shop/' + s.slug })) };
      if (!rows.length && (/^(RESTAURANT|CAFE)$/.test(where.category || '') || FOOD_RE.test(term))) {
        const m = await mapFood(term, where.category, base).catch(() => null);
        if (m && m.places.length) {
          out.mapPlaces = m.places; out.count += m.places.length;
          out.mapNote = FOOD_NOTE
            + (m.near ? ' Nearest to ' + m.near + ' first; each distance is from ' + m.near + ', not from the person.' : '') + (m.unmatched ? ' None of these names mentions "' + m.unmatched + '": say that, and offer them as food places nearby.' : '');
        }
      }
      return out;
    },
    async watch_channels({ q, kind }) {
      let data;
      try { data = JSON.parse(require('fs').readFileSync(ctx.channelsFile || require('path').join(__dirname, '..', 'watch', 'channels.json'), 'utf8')); } catch (e) { return { error: 'channel list unavailable' }; }
      const base = (ctx.publicBase || 'https://bina.et') + '/watch';
      // Match on meaningful words only: "ደራሽ ድራማ" must find ደራሽ, "sheger radio" must find Sheger FM.
      const STOP = /^(the|a|open|play|listen|watch|to|radio|tv|fm|channel|station|series|drama|show|me|please|ራዲዮ|ራድዮ|ቲቪ|ቻናል|ጣቢያ|ኤፍኤም|ድራማ|ተከታታይ|ፊልም|ክፈት|ክፈትልኝ|አሳየኝ|ማየት|እፈልጋለሁ|ልኝ|raadiyoo|televizhinii|banaa|bani|naaf|ilaaluu|dhaggeeffachuu|jira|jiraa)$/i;
      const words = String(q || '').toLowerCase().split(/[\s,፣።·]+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(w => w.length >= 2 && !STOP.test(w));
      const hit = s => !words.length || words.some(w => String(s || '').toLowerCase().includes(w));
      const want = k => !kind || kind === 'all' || kind === k;
      const out = [];
      if (want('tv')) for (const c of data.tv || []) if (hit(c.name) || hit(c.nameAm) || hit(c.id)) out.push({ kind: 'tv', name: c.name, nameAm: c.nameAm, tag: c.tag, openUrl: base + '?open=tv/' + c.id });
      if (want('radio')) for (const c of data.radio || []) if (hit(c.name) || hit(c.nameAm) || hit(c.id)) out.push({ kind: 'radio', name: c.name, nameAm: c.nameAm, tag: c.tag, openUrl: base + '?open=radio/' + c.id });
      if (want('kids')) for (const c of data.kids || []) if (hit(c.name) || hit(c.nameAm) || hit(c.id)) out.push({ kind: 'kids', name: c.name, nameAm: c.nameAm, openUrl: base + '?open=kids/' + c.id });
      if (want('series')) for (const s of data.series || []) if (hit(s.title) || hit(s.titleAm) || hit(s.id)) out.push({ kind: 'series', name: s.title, nameAm: s.titleAm, genre: s.kind, openUrl: base + '?open=series/' + s.id });
      return { count: out.length, items: out.slice(0, 12), allUrl: base, note: out.length ? 'Give the openUrl; it opens inside BinaWatch (free, Ethiopian content only).' : 'Not on BinaWatch; say so and offer the full list at /watch. Do not link outside sites.' };
    },
    async search_jobs({ q, field, city, limit }) {
      const qs = new URLSearchParams();
      if (q) qs.set('q', String(q).slice(0, 60));
      if (field) qs.set('field', String(field).slice(0, 20));
      if (city) qs.set('city', String(city).slice(0, 40));
      qs.set('limit', String(Math.min(Math.max(Number(limit) || 6, 1), 10)));
      const d = await api('GET', '/api/jobs/search?' + qs.toString());
      if (d.error) return d;
      if (!d.jobs || !d.jobs.length) return { results: [], note: 'No open vacancy matches that right now. All vacancies: https://bina.et/jobs' };
      return { results: d.jobs, note: 'Open vacancies on bina.et. BinaSmart never charges a job seeker; an advert that asks for a fee is a scam.' };
    },
    // The live /property listings (server.js /api/properties/search). Contacts are the listing company's own.
    async search_properties({ listing, type, area, beds, maxPrice, q, limit }) {
      const qs = new URLSearchParams();
      if (listing === 'sale' || listing === 'rent') qs.set('listing', listing);
      if (type) qs.set('type', String(type).slice(0, 30));
      if (area) qs.set('area', String(area).slice(0, 40));
      if (beds != null && beds !== '' && !isNaN(Number(beds))) qs.set('beds', String(Number(beds)));
      if (maxPrice && Number(maxPrice) > 0) qs.set('maxPrice', String(Number(maxPrice)));
      if (q) qs.set('q', String(q).slice(0, 60));
      qs.set('limit', String(Math.min(Math.max(Number(limit) || 5, 1), 8)));
      const d = await api('GET', '/api/properties/search?' + qs.toString());
      if (d.error) return d;
      if (!d.results || !d.results.length) return { results: [], note: 'No listing matches that right now. Say so plainly, suggest widening it (another area, a higher budget), and give https://bina.et/property (all listings) and https://bina.et/property#request (free: BinaSmart searches for them).' };
      return { total: d.total, results: d.results, note: 'Real listings from the companies\' own websites. For each one you mention give its link (it opens that listing on bina.et) and the company\'s own phone/WhatsApp: the buyer contacts the company directly, BinaSmart is not the agent. Say prices exactly as written (some are per m² or in USD). Mention only listings listed here.' };
    },
    // The live /cars listings (server.js /api/cars/search). Contacts are the dealer's own.
    async search_cars(a) {
      const qs = new URLSearchParams();
      for (const k of ['make', 'model', 'body', 'fuel', 'transmission', 'condition', 'q', 'sort', 'where']) if (a[k]) qs.set(k, String(a[k]).slice(0, 40));
      for (const k of ['minYear', 'maxPrice']) if (Number(a[k]) > 0) qs.set(k, String(Number(a[k])));
      qs.set('limit', String(Math.min(Math.max(Number(a.limit) || 5, 1), 8)));
      const d = await api('GET', '/api/cars/search?' + qs.toString());
      if (d.error) return d;
      if (!d.results || !d.results.length) return { results: [], note: 'No car matches that right now. Say so plainly, suggest widening it (another make, a higher budget), and give https://bina.et/cars (all cars) and https://bina.et/cars#request (free: BinaSmart looks for it).' };
      return { total: d.total, results: d.results, note: 'Real cars from the dealers\' own websites. For each one you mention give its link and the dealer\'s own phone/WhatsApp: the buyer contacts the dealer directly, BinaSmart is not the seller. Say prices exactly as written. Mention only cars listed here. A car whose location says "In China" is in China: say so, and say its USD price is the China price BEFORE shipping, customs duty and taxes (ask the importer for the full price in birr).' };
    },
    // The hotel directory (hotels/directory.js /api/hotels/search). No prices exist there - the tool says so.
    async search_hotels({ area, kind, minStars, q, limit }) {
      const qs = new URLSearchParams();
      if (area) qs.set('area', String(area).slice(0, 40));
      if (kind) qs.set('kind', String(kind).slice(0, 20));
      if (Number(minStars) > 0) qs.set('minStars', String(Number(minStars)));
      if (q) qs.set('q', String(q).slice(0, 60));
      qs.set('limit', String(Math.min(Math.max(Number(limit) || 6, 1), 10)));
      const d = await api('GET', '/api/hotels/search?' + qs.toString());
      if (d.error) return d;
      if (!d.results || !d.results.length) return { results: [], note: 'No place in the directory matches. Say so, suggest another area or type, and give https://bina.et/hotels (all hotels and guest houses in Addis).' };
      return { total: d.total, results: d.results, note: 'From the city map (OpenStreetMap), not a booking system: there are NO free-room checks here, and a price only where roomsFrom is set (the hotel\'s own price: tell the guest to confirm it with the hotel). guestRating comes only from real BinaSmart rides that ended there. Give each hotel\'s phone or website and its link, and tell the guest to call the hotel to book and confirm the price. Mention only hotels listed here.' };
    },
    async search_health({ kind, area, q, limit }) {
      const qs = new URLSearchParams();
      if (kind) qs.set('kind', String(kind).slice(0, 20));
      if (q) qs.set('q', String(q).slice(0, 60));
      qs.set('limit', String(Math.min(Math.max(Number(limit) || 6, 1), 10)));
      let near = null;
      if (area) {
        const a = String(area).slice(0, 40);
        // a sub-city filters; anything else (Piassa, CMC, a landmark) is a point on the map, nearest first
        if (HEALTH_SUBCITY.test(a.trim())) qs.set('area', a);
        else {
          const s = await H.search_places({ q: a }).catch(() => null), p = s && (s.results || []).find(r => inAddis(r));
          if (p) { qs.set('lat', String(p.lat)); qs.set('lng', String(p.lng)); near = p.name; } else qs.set('area', a);
        }
      }
      const d = await api('GET', '/api/health/search?' + qs.toString());
      if (d.error) return d;
      const note = 'From BinaSmart Health: the city map (OpenStreetMap) plus what facilities confirmed. Name each place with its phone and its url (bina.et/health link). '
        + 'Hours and night service are NOT known unless "hours" is given: say so and tell them to call before going. No diagnosis, no treatment advice: '
        + 'for which department, Dr Afiya at https://bina.et/afiya; anything urgent: 907. The person asked WHERE to go: do not add what an illness might be, how it is treated or which illnesses are free. Put each place\'s url right after its name, and end with the "more" link for the full list.';
      if (!(d.results || []).length && !(d.doctors || []).length)
        return { results: [], note: 'Nothing in the directory matches' + (near ? ' near ' + near : '') + '. Say so plainly, suggest a nearby sub-city or another kind of place, and give https://bina.et/health (every hospital, clinic, dentist and lab in Addis).' };
      return Object.assign({}, d, near ? { near } : {}, { note });
    },
    // Collects a vacancy; it does NOT publish one. jobs/submit.js explains why a person approves first.
    async post_job(a) {
      const body = {};
      for (const k of ['employerName', 'title', 'city', 'jobType', 'salary', 'deadline', 'summary', 'bodyHtml', 'howToApply', 'submitter']) {
        if (a[k]) body[k] = String(a[k]).slice(0, k === 'bodyHtml' ? 8000 : 300);
      }
      body.source = 'bini';
      if (!body.employerName || !body.title) return { error: 'employerName and title are required — ask the employer for the company name and the job title' };
      const d = await api('POST', '/api/jobs/submit', body);
      if (d.error) return d;
      return { ok: true, status: 'pending_review',
        tell_the_user: 'It has been sent to the BinaSmart team. A person checks every advert before it goes on the board — usually within a few hours — and it is free.' };
    },
    // The subscription lives on a Telegram chat id, because that is where the morning message is sent
    // (ops/send-job-alerts.js, via @bina_smart_bot). On the website there is nowhere to send to, so the
    // tool says so plainly rather than saving a row that can never be delivered.
    async job_alert({ action, field, city }) {
      if (!ctx.prisma) return { error: 'alerts unavailable' };
      const chatId = ctx.telegramId ? String(ctx.telegramId) : null;
      if (!chatId) return { ok: false, note: 'Job alerts are sent on Telegram, and this conversation is not on Telegram.',
        tell_the_user: 'Open t.me/bina_smart_bot and ask me there — then I can send you the alert every morning.' };

      if (action === 'list') {
        const rows = await ctx.prisma.jobAlert.findMany({ where: { chatId, active: true }, select: { field: true, city: true } });
        return { ok: true, alerts: rows };
      }
      const f = String(field || '').trim();
      if (!f) return { ok: false, note: 'Ask which field of work first.' };

      if (action === 'stop') {
        const r = await ctx.prisma.jobAlert.updateMany({ where: { chatId, field: f }, data: { active: false } });
        return { ok: true, stopped: r.count, tell_the_user: r.count ? 'Stopped.' : 'There was no alert for that field.' };
      }
      // Subscribe. lastSentAt starts now on purpose: a new subscriber gets tomorrow's vacancies, never
      // a dump of the archive.
      const now = new Date();
      const row = await ctx.prisma.jobAlert.upsert({
        where: { chatId_field: { chatId, field: f } },
        update: { active: true, city: city || null, lang: ctx.lang === 'en' ? 'en' : (ctx.lang === 'om' ? 'om' : 'am') },
        create: { chatId, field: f, city: city || null, lang: ctx.lang === 'en' ? 'en' : (ctx.lang === 'om' ? 'om' : 'am'), lastSentAt: now },
      });
      return { ok: true, field: row.field, city: row.city || null,
        tell_the_user: 'Done — every morning I will send the new vacancies in that field. Say stop any time.' };
    },
    async remember({ field, value, lat, lng }) {
      if (!ctx.memory || !ctx.memory.persistent) return { ok: false, note: 'This channel has no stable identity; nothing saved. Suggest the Telegram bot @bina_smart_bot for memory.' };
      const patch = {};
      if (field === 'home' || field === 'work') {
        let place = { label: String(value).slice(0, 80), lat: Number.isFinite(+lat) ? +lat : null, lng: Number.isFinite(+lng) ? +lng : null };
        if (place.lat == null) { // resolve the name ourselves so "remember my home is CMC" saves coordinates in one step
          const s = await H.search_places({ q: value });
          const first = s && s.results && s.results[0];
          if (first) place = { label: first.name, lat: first.lat, lng: first.lng };
        }
        patch[field] = place;
        await ctx.memory.touch(patch);
        return { ok: true, saved: field, place: place.label, hasCoordinates: place.lat != null, note: place.lat == null ? 'Place not found on the map; saved the name only.' : 'Saved with coordinates; from now on quote_ride can use it directly.' };
      }
      patch[field] = String(value).slice(0, field === 'notes' ? 400 : 80);
      await ctx.memory.touch(patch);
      return { ok: true, saved: field };
    },
    async company_request({ company, kind, name, role, phone, request, rooms, dishes, hours, publicPhone }) {
      const want = String(company || '').trim(), note = String(request || '').trim();
      if (!want || !note) return { error: 'need the company and exactly what to change' };
      // BinaSmart is not a listing. 28 Sep 2026: a question about driver commission reached the team as a "hotel claim"
      // for a hotel called "BinaSmart".
      if (/^(bina\s*-?\s*smart|bini|bina(\.et)?|bina\s*ride|binaride|\u1262\u1293\s*\u1235\u121b\u122d\u1275|\u1262\u1292)$/i.test(want.replace(/["'.,!?]+$/g, '').trim())) {
        return { error: 'not_a_listing', note: 'BinaSmart itself is not a company or hotel page. The person asked about BinaSmart: answer from what you know (search_knowledge), or use contact_team if they need a person. Do NOT call company_request for this.' };
      }
      const who = { name: String(name || '').slice(0, 80), role: ['owner', 'manager', 'staff'].includes(role) ? role : 'owner', phone: String(phone || ''), note: ('[via Bini] ' + note).slice(0, 500) };
      // A restaurant, cafe or fast-food place on bina.et/restaurants (1 Oct 2026): its own claim path, since a shop page
      // needs a tenancy in a building BinaSmart manages.
      let rests = null; try { rests = require('../restaurants/directory').places(); } catch (e) { rests = null; }
      const rest = rests ? (rests.bySlug.get(want) || (kind === 'restaurant' ? rests.list.find(x => x.name.toLowerCase() === want.toLowerCase()) || null : null)) : null;
      if (rest || kind === 'restaurant') {
        const rb = Object.assign(rest ? { ref: rest.ref } : { ref: 'new', restaurant: want.slice(0, 90) }, { name: who.name, role: who.role, phone: who.phone, note: who.note,
          dishes: Array.isArray(dishes) ? dishes.slice(0, 30) : undefined, hours: hours ? String(hours).slice(0, 120) : undefined, publicPhone: publicPhone ? String(publicPhone) : undefined });
        if (ctx.dryRun) return { ok: true, dryRun: true, wouldSend: rb, note: 'Evaluation run, nothing was sent. Otherwise answer exactly as if it was sent: the team calls this number to confirm, then approves it, usually within a day; it is NOT live yet.' };
        const rd = await api('POST', '/api/restaurants/claim', rb, phone);
        if (rd.error) return { error: rd.error === 'phone' ? 'that phone number looks wrong; ask for an Ethiopian number like 0900 000 012' : rd.error === 'name' ? 'ask for their name' : rd.error === 'restaurant' ? 'ask for the restaurant name' : rd.error === 'slow_down' ? 'too many requests from this number; ask them to try again later' : rd.error };
        return { ok: true, restaurant: rest ? rest.name : want, page: rest ? (ctx.publicBase || 'https://bina.et') + '/restaurants/' + rest.slug : null, note: 'Sent to the BinaSmart team. Tell them: the team calls this number to confirm, then approves it, usually within a day; it is NOT live yet. It is free, with no commission.' };
      }
      let hotels = [];
      try { hotels = require('../hotels/directory').list() || []; } catch (e) { hotels = []; }
      const hk = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u1200-\u137f]+/g, ' ').trim();
      const hotel = hotels.find(x => x.slug === want) || (kind === 'hotel' ? (hotels.find(x => hk(x.name) === hk(want)) || null) : null);
      if (hotel || kind === 'hotel') {
        const hb = Object.assign(hotel ? { ref: hotel.ref } : { ref: 'new', hotel: want.slice(0, 120) }, who);
        if (Array.isArray(rooms) && rooms.length) hb.rooms = rooms.slice(0, 12);
        if (ctx.dryRun) return { ok: true, dryRun: true, wouldSend: hb, note: 'Evaluation run, nothing was sent. Otherwise answer exactly as if it was sent: the team calls this number to confirm, then approves it, usually within a day; it is NOT live yet.' };
        const hd = await api('POST', '/api/hotels/claim', hb, phone);
        if (hd.error) return { error: hd.error === 'phone' ? 'that phone number looks wrong; ask for an Ethiopian number like 0900 000 012' : hd.error === 'name' ? 'ask for their name' : hd.error === 'slow_down' ? 'too many requests from this number; ask them to try again later' : hd.error };
        return { ok: true, hotel: hotel ? hotel.name : want, page: hotel ? (ctx.publicBase || 'https://bina.et') + '/hotels/' + hotel.slug : null, note: 'Sent to the BinaSmart team. Tell them: the team calls this number to confirm, then approves it, usually within a day; it is NOT live yet. Guests book with the hotel directly, with 0% commission. Once approved, the hotel can change its room prices itself at https://bina.et/hotels/dashboard, signed in with this number.' + (hb.rooms ? ' The room prices show on the hotel page once the team approves.' : '') };
      }
      let list = [];
      try { list = require('../companies/directory').list() || []; } catch (e) { list = []; }
      const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u1200-\u137f]+/g, ' ').trim();
      const k = key(want);
      const c = list.find(x => x.slug === want) || list.find(x => key(x.name) === k) || (k.length > 3 ? list.find(x => key(x.name).includes(k) || k.includes(key(x.name))) : null);
      const body = c ? { ref: 'company:' + c.slug } : { ref: 'new:' + (/car|auto|motor|dealer|መኪና/i.test(want + ' ' + note) ? 'car_seller' : 'real_estate'), company: want.slice(0, 120) };
      Object.assign(body, { name: String(name || '').slice(0, 80), role: ['owner', 'manager', 'staff'].includes(role) ? role : 'owner', phone: String(phone || ''), note: ('[via Bini] ' + note).slice(0, 500) });
      if (ctx.dryRun) return { ok: true, dryRun: true, wouldSend: body, note: 'Evaluation run, nothing was sent. Otherwise answer exactly as if it was sent: the team calls this number to confirm, then approves the change, usually within a day; it is NOT live yet.' };
      const d = await api('POST', '/api/companies/claim', body, phone);
      if (d.error) return { error: d.error === 'phone' ? 'that phone number looks wrong; ask for an Ethiopian number like 0900 000 012' : d.error === 'name' ? 'ask for their name' : d.error === 'slow_down' ? 'too many requests from this number; ask them to try again later' : d.error };
      return { ok: true, company: c ? c.name : want, page: c ? (ctx.publicBase || 'https://bina.et') + '/companies/' + c.slug : null, note: 'Sent to the BinaSmart team. Tell them: the team calls this number to confirm, then approves the change, usually within a day; it is NOT live yet. Homes or cars they add to their own website also appear on BinaSmart by themselves every week. It is free, with no commission.' };
    },
    async shop_post(a) {
      const body = { action: a.action || 'add', shop: a.shop, area: a.area, kind: a.kind, title: a.title, price: a.price, category: a.category,
        description: a.description, name: a.name, phone: a.phone, whatsapp: a.whatsapp !== false, post: a.post, request: a.request, uid: ctx.uid || undefined };
      const done = 'Tell them: it is NOT live yet; the team calls this number to confirm, then approves, usually within a day. It is free, with no commission; buyers call or WhatsApp the shop directly; once live it is on bina.et/shop and findable on Google and by AI assistants.';
      if (ctx.dryRun) return { ok: true, dryRun: true, wouldSend: body, note: 'Evaluation run, nothing was sent. Otherwise answer exactly as if it was sent. ' + done };
      const r = await f(ctx.base + '/api/shop/post', { method: 'POST', headers: { 'content-type': 'application/json',
        'x-bini-internal': require('../shops/posts').INTERNAL_KEY, 'x-real-ip': 'bini-' + String(a.phone || '').replace(/\D/g, '').slice(-9) }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        const e = d.error || ('http_' + r.status);
        return { error: e === 'phone' ? 'that phone number looks wrong; ask for an Ethiopian number like 0900 000 012' : e === 'name' ? 'ask for their name'
          : e === 'shop' ? 'ask for the shop name' : e === 'title' ? 'ask what they are selling' : e === 'price' ? 'ask the price'
          : e === 'slow_down' ? 'too many posts just now; ask them to try again in an hour' : e };
      }
      if (d.duplicate) return { ok: true, note: 'This post was already sent a moment ago; do not send it again. ' + done };
      return { ok: true, photos: d.photos, matched: d.matched, note: (a.action && a.action !== 'add' ? 'Sent to the team; they call to confirm, then make the change. Tell them too: the price, the description and "sold" they can now change themselves at https://bina.et/shop/dashboard, signed in with the number on the post.' : done + ' Once it is live, they can change the price or mark it sold themselves at https://bina.et/shop/dashboard.') + (d.photos ? ' ' + d.photos + ' photo(s) went with it.' : '') };
    },
    async listing_request(a) {
      const body = { action: a.action || 'add', listingType: a.listing_type, propertyType: a.property_type, location: a.location, price: a.price,
        beds: a.beds, baths: a.baths, size: a.size, description: a.description, name: a.name, role: a.role, company: a.company,
        phone: a.phone, whatsapp: a.whatsapp !== false, listing: a.listing, request: a.request, uid: ctx.uid || undefined };
      const done = 'Tell them: it is NOT live yet; the team calls this number to confirm, then approves, usually within a day. It is free, with no commission, and buyers or tenants contact them directly. On bina.et/property it is findable on Google and by AI assistants. Once it is live, they can change the price or mark it rented / sold themselves at https://bina.et/property/dashboard, signed in with this number.';
      if (ctx.dryRun) return { ok: true, dryRun: true, wouldSend: body, note: 'Evaluation run, nothing was sent. Otherwise answer exactly as if it was sent. ' + done };
      const r = await f(ctx.base + '/api/property/owner-listing', { method: 'POST', headers: { 'content-type': 'application/json',
        'x-bini-internal': require('../property/owner-listing').INTERNAL_KEY, 'x-real-ip': 'bini-' + String(a.phone || '').replace(/\D/g, '').slice(-9) }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        const e = d.error || ('http_' + r.status);
        return { error: e === 'phone' ? 'that phone number looks wrong; ask for an Ethiopian number like 0900 000 012' : e === 'name' ? 'ask for their name'
          : e === 'location' ? 'ask which area or neighbourhood' : e === 'type' ? 'ask what kind of property it is' : e === 'price' ? 'ask the price'
          : e === 'slow_down' ? 'too many requests just now; ask them to try again in an hour' : e };
      }
      if (body.action !== 'add') return { ok: true, note: 'Sent to the team. Tell them the team will call to confirm and then make the change.' };
      return { ok: true, photos: d.photos || 0, duplicate: !!d.duplicate, note: (d.photos ? 'It includes ' + d.photos + ' photo(s). ' : 'No photos came with it; they can still send photos in this chat and tell you, or the team can take them on the call. ') + done };
    },
    async bini_browser_lead(a) {
      const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
      const lead = { name: clip(a.name, 80), organisation: clip(a.organisation, 120), kind: clip(a.kind, 20) || 'other', role: clip(a.role, 60),
        phone: clip(a.phone, 30), need: clip(a.need, 300), computers: clip(a.computers, 40) };
      if (!lead.name) return { error: 'ask for their name' };
      if (!lead.organisation) return { error: 'ask which office or company it is for (or "personal")' };
      if (!/^(251|0)?[79]\d{8}$/.test(lead.phone.replace(/\D/g, ''))) return { error: 'that phone number looks wrong; ask for an Ethiopian number like 0900 000 012' };
      if (!lead.need) return { error: 'ask what website work they want help with' };
      const done = 'Tell them: the team calls this number to set Bini Browser up, usually within a day. Do not quote a price and do not say it is free.';
      // one lead per turn: the 1 Oct Amharic rehearsal called it three times in one reply
      if (ctx._agentLead) return Object.assign({}, ctx._agentLead, { note: 'Already sent to the team in this reply - do NOT call bini_browser_lead again. ' + done });
      if (ctx.dryRun) return (ctx._agentLead = { ok: true, dryRun: true, wouldSend: lead, note: 'Evaluation run, nothing was sent. Otherwise answer exactly as if it was sent. ' + done });
      if (!ctx.handover) return { error: 'could not reach the team now; give them https://t.me/Bina_smart' };
      const summary = ['🧭 BINI BROWSER LEAD (bina.et/agent)', 'Who: ' + lead.name + (lead.role ? ' (' + lead.role + ')' : ''),
        'Where: ' + lead.organisation + ' [' + lead.kind + ']', 'Phone: ' + lead.phone, 'Needs: ' + lead.need, lead.computers ? 'Size: ' + lead.computers : ''].filter(Boolean).join('\n');
      const sent = await ctx.handover({ summary, reason: 'Bini Browser lead', explicit: true }).catch(() => false);
      if (sent === false) console.warn('[bini] bini_browser_lead: the team chat was not paged');
      return (ctx._agentLead = { ok: true, note: done });
    },
    async contact_team({ summary, reason }) {
      if (ctx.handover) await ctx.handover({ summary: String(summary || '').slice(0, 600), reason: String(reason || 'user asked for a person').slice(0, 120), explicit: true }).catch(() => {});
      return { ok: true, note: 'The team has the summary. Tell the user someone will reply here or on WhatsApp +251 911 244 344, and ask nothing more unless needed.' };
    },
  };
  // company_request sends a message to the team: the same request twice in one turn is answered from the first one
  // (28 Sep 2026: a hotel-price eval saw the model call it in rounds 1, 2 and 3)
  const sentOnce = new Map();
  return async function execute(name, args) {
    const fn = H[name]; if (!fn) return { error: 'unknown_tool' };
    if (ctx.dryRun) console.log('[bini-eval] tool ' + name + ' ' + JSON.stringify(args || {}).slice(0, 700));
    // the same request with its fields in another order is still the same request
    const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
    const key = name === 'company_request' || name === 'listing_request' || name === 'shop_post' || name === 'bini_browser_lead' ? canon(args || {}) : null;
    if (key && sentOnce.has(key)) return Object.assign({}, sentOnce.get(key), { note: 'Already sent to the team a moment ago - do NOT call ' + name + ' again. Answer the person now: the team calls to confirm, then approves, usually within a day; it is NOT live yet.' });
    try { const out = await fn(args || {}); if (key && out && out.ok) sentOnce.set(key, out); return out; } catch (e) { return { error: 'tool_failed: ' + (e && e.message || e) }; }
  };
}

module.exports = { DEFS, toOpenAI, makeExecutor, inAddis, TIERS, AGENT_RE, AGENT_FACTS, AGENT_ASK };
