/**
 * Industry intelligence.
 *
 * These are *starting points* that inform scoring (local demand), the website
 * brief (page set, conversion goal, trust elements) and the mock discovery
 * provider. They are not templates: the brief generator treats them as priors
 * that the business's own data overrides.
 */

export type IndustryProfile = {
  id: string;
  label: string;
  aliases: string[];
  /** 0-1. How much a local business in this category depends on local search. */
  localDemand: number;
  /** Typical project value band for a replacement site. */
  valueBand: "starter" | "standard" | "premium" | "flagship";
  primaryConversion: string;
  secondaryConversions: string[];
  corePages: string[];
  optionalPages: string[];
  trustElements: string[];
  /** Things that materially hurt conversion in this category specifically. */
  conversionRisks: string[];
  typicalServices: string[];
};

export const INDUSTRIES: IndustryProfile[] = [
  {
    id: "dental",
    label: "Dental",
    aliases: ["dentist", "dentists", "dental clinic", "orthodontist"],
    localDemand: 0.95,
    valueBand: "standard",
    primaryConversion: "Book an appointment",
    secondaryConversions: ["Call the clinic", "WhatsApp enquiry", "Ask about pricing"],
    corePages: ["Home", "Services", "Doctors", "Contact", "Booking"],
    optionalPages: ["Service Detail", "Testimonials", "Gallery", "FAQ", "Pricing"],
    trustElements: [
      "Practitioner registration numbers",
      "Years in practice",
      "Before/after gallery with consent",
      "Google review excerpts",
      "Clinic photographs",
    ],
    conversionRisks: [
      "No visible booking path on mobile",
      "Phone number not tap-to-call",
      "Opening hours buried or absent",
      "No indication of pricing or insurance",
    ],
    typicalServices: [
      "Root canal treatment",
      "Dental implants",
      "Braces and aligners",
      "Teeth whitening",
      "Paediatric dentistry",
    ],
  },
  {
    id: "medical",
    label: "Medical & Clinics",
    aliases: ["clinic", "doctor", "physiotherapy", "dermatologist", "hospital"],
    localDemand: 0.93,
    valueBand: "premium",
    primaryConversion: "Book a consultation",
    secondaryConversions: ["Call reception", "Download patient form"],
    corePages: ["Home", "Services", "Doctors", "Contact", "Booking"],
    optionalPages: ["Locations", "FAQ", "Testimonials", "Blog"],
    trustElements: [
      "Qualifications and affiliations",
      "Clinic accreditation",
      "Named practitioners with photographs",
    ],
    conversionRisks: [
      "No triage between services",
      "Appointment flow requires a phone call only",
      "No location or parking detail",
    ],
    typicalServices: ["Consultation", "Diagnostics", "Follow-up care"],
  },
  {
    id: "restaurant",
    label: "Restaurant & Cafe",
    aliases: ["restaurant", "cafe", "bakery", "bar", "cloud kitchen"],
    localDemand: 0.9,
    valueBand: "starter",
    primaryConversion: "Reserve a table",
    secondaryConversions: ["View the menu", "Order online", "Get directions"],
    corePages: ["Home", "Menu", "Contact"],
    optionalPages: ["Gallery", "About", "Locations", "Events", "Booking"],
    trustElements: ["Food photography", "Review excerpts", "Awards if verifiable"],
    conversionRisks: [
      "Menu published only as a PDF",
      "No hours or a stale festive notice",
      "Reservation link points to a dead third party",
    ],
    typicalServices: ["Dine-in", "Takeaway", "Delivery", "Private events"],
  },
  {
    id: "salon",
    label: "Salon & Spa",
    aliases: ["salon", "spa", "barber", "beauty parlour", "nail studio"],
    localDemand: 0.88,
    valueBand: "starter",
    primaryConversion: "Book a slot",
    secondaryConversions: ["See the price list", "WhatsApp the studio"],
    corePages: ["Home", "Services", "Pricing", "Contact", "Booking"],
    optionalPages: ["Gallery", "Team", "Testimonials"],
    trustElements: ["Stylist portfolios", "Hygiene and product brands", "Reviews"],
    conversionRisks: [
      "No price transparency",
      "Booking via Instagram DM only",
      "Gallery images heavily compressed",
    ],
    typicalServices: ["Hair", "Skin", "Nails", "Bridal packages"],
  },
  {
    id: "gym",
    label: "Gym & Fitness",
    aliases: ["gym", "fitness", "yoga", "crossfit", "pilates"],
    localDemand: 0.85,
    valueBand: "standard",
    primaryConversion: "Book a trial session",
    secondaryConversions: ["See membership plans", "Call the studio"],
    corePages: ["Home", "Services", "Pricing", "Contact"],
    optionalPages: ["Team", "Testimonials", "Gallery", "FAQ", "Booking"],
    trustElements: ["Trainer credentials", "Member results with consent", "Facility photos"],
    conversionRisks: [
      "Membership pricing hidden behind a form",
      "No trial offer",
      "Class timetable not published",
    ],
    typicalServices: ["Personal training", "Group classes", "Nutrition coaching"],
  },
  {
    id: "real-estate",
    label: "Real Estate",
    aliases: ["real estate", "property", "realtor", "broker"],
    localDemand: 0.8,
    valueBand: "premium",
    primaryConversion: "Request a site visit",
    secondaryConversions: ["Browse listings", "Download brochure"],
    corePages: ["Home", "Services", "Contact"],
    optionalPages: ["Locations", "Testimonials", "Gallery", "Blog", "Pricing"],
    trustElements: ["RERA registration", "Completed projects", "Client testimonials"],
    conversionRisks: [
      "Listings not filterable",
      "No agent contact on listing pages",
      "Stale inventory",
    ],
    typicalServices: ["Residential sales", "Commercial leasing", "Property management"],
  },
  {
    id: "law",
    label: "Law Firm",
    aliases: ["law", "lawyer", "advocate", "legal", "attorney"],
    localDemand: 0.7,
    valueBand: "premium",
    primaryConversion: "Request a consultation",
    secondaryConversions: ["Call the practice", "Read practice areas"],
    corePages: ["Home", "Services", "Team", "Contact"],
    optionalPages: ["Service Detail", "Blog", "FAQ", "Locations"],
    trustElements: ["Bar registration", "Practice areas", "Reported matters"],
    conversionRisks: [
      "Practice areas written as an undifferentiated list",
      "No named lawyers",
      "Consultation process unexplained",
    ],
    typicalServices: ["Corporate", "Litigation", "Property", "Family law"],
  },
  {
    id: "accounting",
    label: "Accounting & Tax",
    aliases: ["accountant", "ca", "chartered accountant", "tax", "audit firm"],
    localDemand: 0.65,
    valueBand: "standard",
    primaryConversion: "Book a discovery call",
    secondaryConversions: ["See service packages", "Download compliance calendar"],
    corePages: ["Home", "Services", "Contact"],
    optionalPages: ["Team", "Pricing", "FAQ", "Blog"],
    trustElements: ["Firm registration", "Years practising", "Client sectors"],
    conversionRisks: [
      "Service scope unclear",
      "No pricing signal at all",
      "Contact form only, no direct line",
    ],
    typicalServices: ["Bookkeeping", "GST filing", "Audit", "Advisory"],
  },
  {
    id: "interior",
    label: "Interior Design",
    aliases: ["interior", "interiors", "interior designer", "decor"],
    localDemand: 0.75,
    valueBand: "premium",
    primaryConversion: "Request a design consultation",
    secondaryConversions: ["View portfolio", "See package pricing"],
    corePages: ["Home", "Services", "Gallery", "Contact"],
    optionalPages: ["About", "Testimonials", "Pricing", "Blog"],
    trustElements: ["Completed project photography", "Process explanation", "Timelines"],
    conversionRisks: [
      "Portfolio images cropped badly on mobile",
      "No indication of budget range",
      "Process and timeline unexplained",
    ],
    typicalServices: ["Residential interiors", "Turnkey fit-out", "Modular kitchens"],
  },
  {
    id: "construction",
    label: "Construction & Trades",
    aliases: ["construction", "builder", "contractor", "civil", "renovation"],
    localDemand: 0.7,
    valueBand: "standard",
    primaryConversion: "Request a quotation",
    secondaryConversions: ["See completed work", "Call the office"],
    corePages: ["Home", "Services", "Gallery", "Contact"],
    optionalPages: ["About", "Testimonials", "FAQ"],
    trustElements: ["Licences", "Completed projects", "Safety record"],
    conversionRisks: ["No project photography", "No service area stated", "Slow quote path"],
    typicalServices: ["Civil works", "Renovation", "Turnkey construction"],
  },
  {
    id: "education",
    label: "Education & Coaching",
    aliases: ["school", "coaching", "tuition", "academy", "institute", "preschool"],
    localDemand: 0.82,
    valueBand: "standard",
    primaryConversion: "Book a campus visit or demo class",
    secondaryConversions: ["Download prospectus", "Call admissions"],
    corePages: ["Home", "Services", "Contact"],
    optionalPages: ["About", "Team", "Testimonials", "FAQ", "Gallery", "Pricing"],
    trustElements: ["Affiliations and boards", "Results with consent", "Faculty profiles"],
    conversionRisks: [
      "Admission process not explained",
      "Fee structure absent",
      "No academic calendar",
    ],
    typicalServices: ["Curriculum", "Test prep", "Extracurriculars"],
  },
  {
    id: "automotive",
    label: "Automotive",
    aliases: ["car", "auto", "garage", "service centre", "detailing", "workshop"],
    localDemand: 0.78,
    valueBand: "starter",
    primaryConversion: "Book a service slot",
    secondaryConversions: ["Get a quote", "Call the workshop"],
    corePages: ["Home", "Services", "Pricing", "Contact"],
    optionalPages: ["Gallery", "Testimonials", "FAQ", "Booking"],
    trustElements: ["Brand authorisations", "Warranty terms", "Technician certifications"],
    conversionRisks: ["No service pricing", "No pickup/drop information", "No booking slot view"],
    typicalServices: ["Periodic service", "Detailing", "Repairs", "Insurance claims"],
  },
  {
    id: "hospitality",
    label: "Hospitality",
    aliases: ["hotel", "resort", "homestay", "guest house", "villa"],
    localDemand: 0.86,
    valueBand: "flagship",
    primaryConversion: "Check availability and book",
    secondaryConversions: ["View rooms", "Contact the property"],
    corePages: ["Home", "Services", "Gallery", "Contact", "Booking"],
    optionalPages: ["Locations", "Testimonials", "FAQ", "Pricing"],
    trustElements: ["Room photography", "Amenity list", "Cancellation policy", "Reviews"],
    conversionRisks: [
      "Booking engine bounces to an unbranded third party",
      "No rate transparency",
      "Gallery is slow and unoptimised",
    ],
    typicalServices: ["Rooms", "Dining", "Events", "Experiences"],
  },
  {
    id: "retail",
    label: "Local Retail",
    aliases: ["shop", "store", "boutique", "retail", "showroom"],
    localDemand: 0.72,
    valueBand: "starter",
    primaryConversion: "Visit the store or enquire",
    secondaryConversions: ["Browse the catalogue", "WhatsApp the shop"],
    corePages: ["Home", "Services", "Contact"],
    optionalPages: ["Gallery", "About", "Locations", "FAQ"],
    trustElements: ["Store photography", "Brands stocked", "Return policy"],
    conversionRisks: ["No catalogue", "Hours missing", "No map or directions"],
    typicalServices: ["In-store sales", "Custom orders", "Home delivery"],
  },
];

const FALLBACK: IndustryProfile = {
  id: "general",
  label: "General Local Business",
  aliases: [],
  localDemand: 0.6,
  valueBand: "starter",
  primaryConversion: "Make an enquiry",
  secondaryConversions: ["Call the business", "See services"],
  corePages: ["Home", "Services", "Contact"],
  optionalPages: ["About", "Gallery", "Testimonials", "FAQ"],
  trustElements: ["Photographs of the real premises", "Review excerpts", "Clear contact detail"],
  conversionRisks: ["No clear next step", "Contact detail hard to find"],
  typicalServices: [],
};

export function resolveIndustry(category: string | null | undefined): IndustryProfile {
  if (!category) return FALLBACK;
  const needle = category.toLowerCase().trim();
  const direct = INDUSTRIES.find(
    (i) => i.id === needle || i.label.toLowerCase() === needle,
  );
  if (direct) return direct;
  const byAlias = INDUSTRIES.find((i) =>
    i.aliases.some((a) => needle.includes(a) || a.includes(needle)),
  );
  return byAlias ?? FALLBACK;
}

export const INDUSTRY_OPTIONS = INDUSTRIES.map((i) => ({
  value: i.label,
  id: i.id,
}));
