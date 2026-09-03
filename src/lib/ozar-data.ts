// ── Ozar Village Dataset — Bhumi-Nakasha Cadastral Intelligence ──────────────
// Source: Ozar_Village_Dataset_final_f.csv  (148 rows, all S.T. caste category)
// Village: Ozar, Niphad Taluka, Nashik District, Maharashtra
// Coordinates approx centroid: 19.928°N, 73.221°E (Ozar CFR zone)

export type SurveyStatus = "Verified" | "Under review" | "Conflict" | "Field verification";
export type RouteDecision = "auto_publish" | "human_review" | "send_to_surveyor";
export type LandUseClass = "forest" | "agricultural" | "homestead" | "water" | "other";

export interface Claimant {
  srNo: number;
  districtCaseNo: number;
  nameMarathi: string;
  nameEnglish: string;
  surveyNo: string;
  areaSqm: number;
  casteCategory: string;
}

export interface SurveySummary {
  surveyNumber: string;
  claimCount: number;
  status: SurveyStatus;
  confidence: number;         // 0–100
  areaLabel: string;
  issue?: string;
  totalAreaSqm: number;
  route: RouteDecision;
  landUseClass: LandUseClass;
  // Approximate SVG map position (% of canvas)
  mapX: number;
  mapY: number;
  mapW: number;
  mapH: number;
  rotation: number;
}

// ── All 148 claimant records from CSV ────────────────────────────────────────
export const claimants: Claimant[] = [
  { srNo: 531,  districtCaseNo: 751,   nameMarathi: "शेवंती बोंगे",                nameEnglish: "Shevanti Bonge",            surveyNo: "463", areaSqm: 10000, casteCategory: "S.T" },
  { srNo: 1016, districtCaseNo: 1766,  nameMarathi: "सिताराम देवजी दिवा",           nameEnglish: "Sitaram Devaji Diva",       surveyNo: "316", areaSqm: 500,   casteCategory: "S.T" },
  { srNo: 1191, districtCaseNo: 2492,  nameMarathi: "देवजे राघो देवा",             nameEnglish: "Devaje Ragho Deva",         surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
  { srNo: 1266, districtCaseNo: 2594,  nameMarathi: "देऊ लक्ष्या फडवळे",            nameEnglish: "Deu Lakshya Phadavale",     surveyNo: "224", areaSqm: 8000,  casteCategory: "S.T" },
  { srNo: 1268, districtCaseNo: 2597,  nameMarathi: "चुनिलाल बचू फडवळे",           nameEnglish: "Chunilal Bachu Phadavale",  surveyNo: "324", areaSqm: 14000, casteCategory: "S.T" },
  { srNo: 1318, districtCaseNo: 2652,  nameMarathi: "अशोक धवळू भोये",             nameEnglish: "Ashok Dhavalu Bhoye",       surveyNo: "327", areaSqm: 6000,  casteCategory: "S.T" },
  { srNo: 1339, districtCaseNo: 2673,  nameMarathi: "शंकर काकडया खानझोडे",         nameEnglish: "Shankar Kakadaya Khanajhode", surveyNo: "324", areaSqm: 4500, casteCategory: "S.T" },
  { srNo: 1374, districtCaseNo: 2750,  nameMarathi: "पवनी बोंगे",                  nameEnglish: "Pavani Bonge",              surveyNo: "324", areaSqm: 9000,  casteCategory: "S.T" },
  { srNo: 1380, districtCaseNo: 2756,  nameMarathi: "नासू गुरव",                   nameEnglish: "Nasu Gurav",                surveyNo: "324", areaSqm: 11500, casteCategory: "S.T" },
  { srNo: 1397, districtCaseNo: 2776,  nameMarathi: "चितामण भोवर",                nameEnglish: "Chitaman Bhovar",           surveyNo: "324", areaSqm: 13000, casteCategory: "S.T" },
  { srNo: 1407, districtCaseNo: 2788,  nameMarathi: "रमेश राघो दिवा",             nameEnglish: "Ramesh Ragho Diva",         surveyNo: "324", areaSqm: 9000,  casteCategory: "S.T" },
  { srNo: 1439, districtCaseNo: 2837,  nameMarathi: "काशिराम लाडक्या टेंबरे",      nameEnglish: "Kashiram Ladakya Tembare",  surveyNo: "324", areaSqm: 9000,  casteCategory: "S.T" },
  { srNo: 1447, districtCaseNo: 2846,  nameMarathi: "बच्चु भिवा फडवळे",           nameEnglish: "Bachchu Bhiva Phadavale",   surveyNo: "324", areaSqm: 13000, casteCategory: "S.T" },
  { srNo: 1645, districtCaseNo: 3070,  nameMarathi: "जान्या नवशा दिघा",            nameEnglish: "Janya Navasha Digha",       surveyNo: "14",  areaSqm: 8000,  casteCategory: "S.T" },
  { srNo: 1731, districtCaseNo: 3173,  nameMarathi: "काकड वांगड",                  nameEnglish: "Kakad Vangad",              surveyNo: "328", areaSqm: 11000, casteCategory: "S.T" },
  { srNo: 1817, districtCaseNo: 3559,  nameMarathi: "संता शंकर गुरव",              nameEnglish: "Santa Shankar Gurav",       surveyNo: "324", areaSqm: 10000, casteCategory: "S.T" },
  { srNo: 1843, districtCaseNo: 3587,  nameMarathi: "बच्चू जानू दिवा",            nameEnglish: "Bachchu Janu Diva",         surveyNo: "324", areaSqm: 16000, casteCategory: "S.T" },
  { srNo: 1895, districtCaseNo: 4534,  nameMarathi: "गोप्या मोहन्या दिवा",         nameEnglish: "Gopya Mohanya Diva",        surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 1924, districtCaseNo: 4618,  nameMarathi: "पांडू धर्मा दिवा",            nameEnglish: "Pandu Dharma Diva",         surveyNo: "324", areaSqm: 20000, casteCategory: "S.T" },
  { srNo: 1935, districtCaseNo: 4629,  nameMarathi: "तुळजे रामा दिवा",            nameEnglish: "Tulaje Rama Diva",          surveyNo: "324", areaSqm: 10000, casteCategory: "S.T" },
  { srNo: 1984, districtCaseNo: 4679,  nameMarathi: "भागी जानु दिवा",             nameEnglish: "Bhagi Janu Diva",           surveyNo: "324", areaSqm: 8000,  casteCategory: "S.T" },
  { srNo: 1986, districtCaseNo: 4681,  nameMarathi: "सोन्या धाकल राजड",           nameEnglish: "Sonya Dhakal Rajad",        surveyNo: "324", areaSqm: 8000,  casteCategory: "S.T" },
  { srNo: 2112, districtCaseNo: 5639,  nameMarathi: "रघु दिघा",                   nameEnglish: "Raghu Digha",               surveyNo: "336", areaSqm: 3500,  casteCategory: "S.T" },
  { srNo: 2140, districtCaseNo: 5675,  nameMarathi: "शांती नडगे",                 nameEnglish: "Shanti Nadage",             surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 2142, districtCaseNo: 5686,  nameMarathi: "चंदर सोमा डांबरे",           nameEnglish: "Chandar Soma Dambare",      surveyNo: "324", areaSqm: 9300,  casteCategory: "S.T" },
  { srNo: 2157, districtCaseNo: 5845,  nameMarathi: "रामजी लाल कडू",              nameEnglish: "Ramaji Lal Kadu",           surveyNo: "316", areaSqm: 500,   casteCategory: "S.T" },
  { srNo: 2288, districtCaseNo: 6630,  nameMarathi: "तुळशि दिवा",                 nameEnglish: "Tulashi Diva",              surveyNo: "324", areaSqm: 5500,  casteCategory: "S.T" },
  { srNo: 2777, districtCaseNo: 7295,  nameMarathi: "किसन गरेल",                  nameEnglish: "Kisan Garel",               surveyNo: "324", areaSqm: 20000, casteCategory: "S.T" },
  { srNo: 2778, districtCaseNo: 7297,  nameMarathi: "काशिराम देऊ दिवा",           nameEnglish: "Kashiram Deu Diva",         surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 2779, districtCaseNo: 7298,  nameMarathi: "शांताराम दिवा",              nameEnglish: "Shantaram Diva",            surveyNo: "324", areaSqm: 20000, casteCategory: "S.T" },
  { srNo: 2780, districtCaseNo: 7299,  nameMarathi: "शांताराम धर्मा काटेला",      nameEnglish: "Shantaram Dharma Katela",   surveyNo: "324", areaSqm: 13000, casteCategory: "S.T" },
  { srNo: 2781, districtCaseNo: 7300,  nameMarathi: "रामदास बेंडू नडगे",          nameEnglish: "Ramadas Bendu Nadage",      surveyNo: "324", areaSqm: 13000, casteCategory: "S.T" },
  { srNo: 2788, districtCaseNo: 8902,  nameMarathi: "रामजी लक्ष्मण वांगड",        nameEnglish: "Ramaji Lakshman Vangad",    surveyNo: "324", areaSqm: 7000,  casteCategory: "S.T" },
  { srNo: 2789, districtCaseNo: 8904,  nameMarathi: "जमना रामजी दिवा",            nameEnglish: "Jamana Ramaji Diva",        surveyNo: "324", areaSqm: 6000,  casteCategory: "S.T" },
  { srNo: 2790, districtCaseNo: 8905,  nameMarathi: "संत्या रघ्या कवाड",          nameEnglish: "Santya Raghya Kavad",       surveyNo: "324", areaSqm: 20000, casteCategory: "S.T" },
  { srNo: 2791, districtCaseNo: 8906,  nameMarathi: "सावजी देऊ वळवी",            nameEnglish: "Savaji Deu Valavi",         surveyNo: "324", areaSqm: 10000, casteCategory: "S.T" },
  { srNo: 2792, districtCaseNo: 8951,  nameMarathi: "किसन जान्या दिवा",           nameEnglish: "Kisan Janya Diva",          surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 2793, districtCaseNo: 8952,  nameMarathi: "वसंत दिवा",                  nameEnglish: "Vasant Diva",               surveyNo: "324", areaSqm: 7000,  casteCategory: "S.T" },
  { srNo: 2794, districtCaseNo: 8953,  nameMarathi: "धाकल राघो दिघा",            nameEnglish: "Dhakal Ragho Digha",        surveyNo: "324", areaSqm: 4530,  casteCategory: "S.T" },
  { srNo: 2795, districtCaseNo: 8954,  nameMarathi: "चांगुणा दिवा",               nameEnglish: "Changuna Diva",             surveyNo: "324", areaSqm: 7200,  casteCategory: "S.T" },
  { srNo: 2796, districtCaseNo: 8955,  nameMarathi: "चंदर ल्रहानु वरठा",          nameEnglish: "Chandar Lrahanu Varatha",   surveyNo: "324", areaSqm: 6700,  casteCategory: "S.T" },
  { srNo: 2797, districtCaseNo: 8956,  nameMarathi: "कमा रंजाड",                  nameEnglish: "Kama Ranjad",               surveyNo: "324", areaSqm: 10000, casteCategory: "S.T" },
  { srNo: 2799, districtCaseNo: 8958,  nameMarathi: "बाबूलाल गुणा दिवा",          nameEnglish: "Babulal Guna Diva",         surveyNo: "324", areaSqm: 7300,  casteCategory: "S.T" },
  { srNo: 2800, districtCaseNo: 8959,  nameMarathi: "शेवती वांगड",               nameEnglish: "Shevati Vangad",            surveyNo: "326", areaSqm: 14000, casteCategory: "S.T" },
  { srNo: 2801, districtCaseNo: 8960,  nameMarathi: "लहानू रुपजी खरपडे",          nameEnglish: "Lahanu Rupaji Kharapade",   surveyNo: "324", areaSqm: 27000, casteCategory: "S.T" },
  { srNo: 3356, districtCaseNo: 10393, nameMarathi: "बाबल्या गवते",              nameEnglish: "Babalya Gavate",            surveyNo: "316", areaSqm: 2600,  casteCategory: "S.T" },
  { srNo: 3442, districtCaseNo: 10735, nameMarathi: "शालु देऊ रडे",              nameEnglish: "Shalu Deu Rade",            surveyNo: "316", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 3643, districtCaseNo: 11291, nameMarathi: "दसमा नडगे",                 nameEnglish: "Dasama Nadage",             surveyNo: "317", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 3681, districtCaseNo: 11530, nameMarathi: "सोन्या राध्या कवाड",         nameEnglish: "Sonya Radhya Kavad",        surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 3686, districtCaseNo: 11536, nameMarathi: "सखाराम रघू कडू",            nameEnglish: "Sakharam Raghu Kadu",       surveyNo: "324", areaSqm: 16000, casteCategory: "S.T" },
  { srNo: 3693, districtCaseNo: 11543, nameMarathi: "जान्या लक्ष्या फडवळे",      nameEnglish: "Janya Lakshya Phadavale",   surveyNo: "324", areaSqm: 5100,  casteCategory: "S.T" },
  { srNo: 3694, districtCaseNo: 11544, nameMarathi: "लाडक्या बोगे",              nameEnglish: "Ladakya Boge",              surveyNo: "324", areaSqm: 6600,  casteCategory: "S.T" },
  { srNo: 3710, districtCaseNo: 11562, nameMarathi: "दामा जान्या दिवा",           nameEnglish: "Dama Janya Diva",           surveyNo: "316", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 3848, districtCaseNo: 11869, nameMarathi: "तुकाराम संत्या दिवा",        nameEnglish: "Tukaram Santya Diva",       surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 5748, districtCaseNo: 14879, nameMarathi: "देवजी रावते",               nameEnglish: "Devaji Ravate",             surveyNo: "324", areaSqm: 1000,  casteCategory: "S.T" },
  { srNo: 5761, districtCaseNo: 14892, nameMarathi: "कृष्णा गणपत बोगे",           nameEnglish: "Krishna Ganapat Boge",      surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 5879, districtCaseNo: 15271, nameMarathi: "बाबन गोपाळ सापटा",           nameEnglish: "Baban Gopal Sapata",        surveyNo: "324", areaSqm: 2200,  casteCategory: "S.T" },
  { srNo: 5935, districtCaseNo: 15326, nameMarathi: "मोहन बाळू फडवळे",           nameEnglish: "Mohan Balu Phadavale",      surveyNo: "324", areaSqm: 2000,  casteCategory: "S.T" },
  { srNo: 5938, districtCaseNo: 15329, nameMarathi: "बाळू लहानू टॅबरे",           nameEnglish: "Balu Lahanu Tabare",        surveyNo: "316", areaSqm: 3000,  casteCategory: "S.T" },
  { srNo: 6074, districtCaseNo: 15874, nameMarathi: "लखमा देवू दिवा",            nameEnglish: "Lakhama Devu Diva",         surveyNo: "316", areaSqm: 600,   casteCategory: "S.T" },
  { srNo: 6084, districtCaseNo: 15884, nameMarathi: "बाळकृष्ण मांवजी फडवळे",     nameEnglish: "Balakrishn Manvaji Phadavale", surveyNo: "316", areaSqm: 1500, casteCategory: "S.T" },
  { srNo: 6088, districtCaseNo: 15888, nameMarathi: "संता शंकर गुरव",             nameEnglish: "Santa Shankar Gurav",       surveyNo: "316", areaSqm: 500,   casteCategory: "S.T" },
  { srNo: 6112, districtCaseNo: 16116, nameMarathi: "चंदर रतन भोवर",             nameEnglish: "Chandar Ratan Bhovar",      surveyNo: "316", areaSqm: 1000,  casteCategory: "S.T" },
  { srNo: 6116, districtCaseNo: 16121, nameMarathi: "बंदु रामू वाहुत",           nameEnglish: "Bandu Ramu Vahut",          surveyNo: "316", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 6128, districtCaseNo: 16133, nameMarathi: "किसन रामजी दिवा",           nameEnglish: "Kisan Ramaji Diva",         surveyNo: "316", areaSqm: 400,   casteCategory: "S.T" },
  { srNo: 6132, districtCaseNo: 16138, nameMarathi: "मंजी गोंदया वाघ",           nameEnglish: "Manji Gondaya Vagh",        surveyNo: "317", areaSqm: 500,   casteCategory: "S.T" },
  { srNo: 6145, districtCaseNo: 16152, nameMarathi: "रमेश बच्चू फडवळे",          nameEnglish: "Ramesh Bachchu Phadavale",  surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
  { srNo: 6164, districtCaseNo: 16171, nameMarathi: "शंकर काकडया दीवा",          nameEnglish: "Shankar Kakadaya Diva",     surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
  { srNo: 6165, districtCaseNo: 16172, nameMarathi: "लाडक देवु दिघा",            nameEnglish: "Ladak Devu Digha",          surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
  { srNo: 6166, districtCaseNo: 16173, nameMarathi: "बाबल्या शंकर मुरद",         nameEnglish: "Babalya Shankar Murad",     surveyNo: "324", areaSqm: 200,   casteCategory: "S.T" },
  { srNo: 6167, districtCaseNo: 16174, nameMarathi: "सुनिल काकडया कवाड",         nameEnglish: "Sunil Kakadaya Kavad",      surveyNo: "324", areaSqm: 100,   casteCategory: "S.T" },
  { srNo: 6168, districtCaseNo: 16175, nameMarathi: "जाऊ फडवळे",                nameEnglish: "Jau Phadavale",             surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
  { srNo: 6169, districtCaseNo: 16176, nameMarathi: "देवराम जान्या बोगे",         nameEnglish: "Devaram Janya Boge",        surveyNo: "317", areaSqm: 200,   casteCategory: "S.T" },
  { srNo: 6170, districtCaseNo: 16177, nameMarathi: "शकर दामु फडवळे",           nameEnglish: "Shakar Damu Phadavale",     surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
  { srNo: 6172, districtCaseNo: 16179, nameMarathi: "आबू दिवा",                 nameEnglish: "Abu Diva",                  surveyNo: "324", areaSqm: 2300,  casteCategory: "S.T" },
  { srNo: 6173, districtCaseNo: 16180, nameMarathi: "लहू देवराम दीवा",           nameEnglish: "Lahu Devaram Diva",         surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
  { srNo: 6701, districtCaseNo: 17652, nameMarathi: "रिती लहू दिवा",             nameEnglish: "Riti Lahu Diva",            surveyNo: "316", areaSqm: 1000,  casteCategory: "S.T" },
  { srNo: 6703, districtCaseNo: 17654, nameMarathi: "रामजी संत्या नडगे",         nameEnglish: "Ramaji Santya Nadage",      surveyNo: "316", areaSqm: 1000,  casteCategory: "S.T" },
  { srNo: 6706, districtCaseNo: 17657, nameMarathi: "मंजी जान्या बोंगे",         nameEnglish: "Manji Janya Bonge",         surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 6717, districtCaseNo: 17667, nameMarathi: "चंदू चैत्या दिवा",          nameEnglish: "Chandu Chaitya Diva",       surveyNo: "324", areaSqm: 200,   casteCategory: "S.T" },
  { srNo: 6726, districtCaseNo: 17677, nameMarathi: "लखमा दिवा",                nameEnglish: "Lakhama Diva",              surveyNo: "316", areaSqm: 400,   casteCategory: "S.T" },
  { srNo: 6735, districtCaseNo: 17685, nameMarathi: "शकर सावंजी दिवा",           nameEnglish: "Shakar Savanji Diva",       surveyNo: "324", areaSqm: 5700,  casteCategory: "S.T" },
  { srNo: 6744, districtCaseNo: 17694, nameMarathi: "नवशा काकडया फडवळे",         nameEnglish: "Navasha Kakadaya Phadavale",surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 6749, districtCaseNo: 17699, nameMarathi: "महादू जानू गरेल",           nameEnglish: "Mahadu Janu Garel",         surveyNo: "316", areaSqm: 400,   casteCategory: "S.T" },
  { srNo: 6759, districtCaseNo: 17710, nameMarathi: "यशवंत नवशा घरट",           nameEnglish: "Yashavant Navasha Gharat",  surveyNo: "324", areaSqm: 3000,  casteCategory: "S.T" },
  { srNo: 6760, districtCaseNo: 17711, nameMarathi: "सोनक गडगे",                nameEnglish: "Sonak Gadage",              surveyNo: "324", areaSqm: 20000, casteCategory: "S.T" },
  { srNo: 6763, districtCaseNo: 17714, nameMarathi: "शंकर काकडया फडवळे",        nameEnglish: "Shankar Kakadaya Phadavale",surveyNo: "324", areaSqm: 600,   casteCategory: "S.T" },
  { srNo: 6765, districtCaseNo: 17716, nameMarathi: "सगुणी खानझोडे",            nameEnglish: "Saguni Khanajhode",         surveyNo: "324", areaSqm: 8100,  casteCategory: "S.T" },
  { srNo: 6770, districtCaseNo: 17722, nameMarathi: "राही किसण गुरव",            nameEnglish: "Rahi Kisan Gurav",          surveyNo: "324", areaSqm: 400,   casteCategory: "S.T" },
  { srNo: 6775, districtCaseNo: 17727, nameMarathi: "बाबू नथु निबारा",           nameEnglish: "Babu Nathu Nibara",         surveyNo: "317", areaSqm: 500,   casteCategory: "S.T" },
  { srNo: 6782, districtCaseNo: 17734, nameMarathi: "धनजी दिवाळ दिवा",          nameEnglish: "Dhanaji Dival Diva",        surveyNo: "324", areaSqm: 9400,  casteCategory: "S.T" },
  { srNo: 6791, districtCaseNo: 17742, nameMarathi: "दसमा श्रावण बोंगे",         nameEnglish: "Dasama Shravan Bonge",      surveyNo: "324", areaSqm: 400,   casteCategory: "S.T" },
  { srNo: 6799, districtCaseNo: 17750, nameMarathi: "वसंत बच्चु फडवळे",          nameEnglish: "Vasant Bachchu Phadavale",  surveyNo: "324", areaSqm: 500,   casteCategory: "S.T" },
  { srNo: 6906, districtCaseNo: 17979, nameMarathi: "विष्णू नडगे",              nameEnglish: "Vishnu Nadage",             surveyNo: "324", areaSqm: 4500,  casteCategory: "S.T" },
  { srNo: 6970, districtCaseNo: 18051, nameMarathi: "लहु दिवा",                 nameEnglish: "Lahu Diva",                 surveyNo: "324", areaSqm: 800,   casteCategory: "S.T" },
  { srNo: 6971, districtCaseNo: 18052, nameMarathi: "नावजी फडवळे",              nameEnglish: "Navaji Phadavale",          surveyNo: "324", areaSqm: 7000,  casteCategory: "S.T" },
  { srNo: 6972, districtCaseNo: 18053, nameMarathi: "गोवजी घाकल फडवले",         nameEnglish: "Govaji Ghakal Phadavale",   surveyNo: "324", areaSqm: 800,   casteCategory: "S.T" },
  { srNo: 6973, districtCaseNo: 18054, nameMarathi: "ब्रक्ष्मण जानू बोंगे",     nameEnglish: "Brakshman Janu Bonge",      surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 6975, districtCaseNo: 18056, nameMarathi: "दीलीप लहानू खरपडे",        nameEnglish: "Dilip Lahanu Kharapade",    surveyNo: "324", areaSqm: 600,   casteCategory: "S.T" },
  { srNo: 6976, districtCaseNo: 18057, nameMarathi: "लक्ष्या रुपा वांगड",        nameEnglish: "Lakshya Rupa Vangad",       surveyNo: "324", areaSqm: 20000, casteCategory: "S.T" },
  { srNo: 6977, districtCaseNo: 18058, nameMarathi: "मोतीराम पडू दिवा",          nameEnglish: "Motiram Padu Diva",         surveyNo: "324", areaSqm: 700,   casteCategory: "S.T" },
  { srNo: 6981, districtCaseNo: 18061, nameMarathi: "नावजी लक्ष्या कडू",         nameEnglish: "Navaji Lakshya Kadu",       surveyNo: "234", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 6982, districtCaseNo: 18062, nameMarathi: "गोविंद सुरज भोवर",         nameEnglish: "Govind Suraj Bhovar",       surveyNo: "324", areaSqm: 700,   casteCategory: "S.T" },
  { srNo: 6983, districtCaseNo: 18063, nameMarathi: "चंदर शिडया फडवळे",         nameEnglish: "Chandar Shidaya Phadavale", surveyNo: "324", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 6984, districtCaseNo: 18064, nameMarathi: "गणेश शंकर नडगे",           nameEnglish: "Ganesh Shankar Nadage",     surveyNo: "324", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 6985, districtCaseNo: 18065, nameMarathi: "सदु फडवळे",               nameEnglish: "Sadu Phadavale",            surveyNo: "324", areaSqm: 1100,  casteCategory: "S.T" },
  { srNo: 6986, districtCaseNo: 18066, nameMarathi: "लक्ष्मण लहानू फडवळे",      nameEnglish: "Lakshman Lahanu Phadavale", surveyNo: "324", areaSqm: 12900, casteCategory: "S.T" },
  { srNo: 6987, districtCaseNo: 18067, nameMarathi: "यशवंत बच्चू फडवळे",        nameEnglish: "Yashavant Bachchu Phadavale",surveyNo: "324", areaSqm: 800,  casteCategory: "S.T" },
  { srNo: 6988, districtCaseNo: 18068, nameMarathi: "तुळशी रघ्या कवाड",          nameEnglish: "Tulashi Raghya Kavad",      surveyNo: "324", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 6989, districtCaseNo: 18069, nameMarathi: "मोहन फडवळे",              nameEnglish: "Mohan Phadavale",           surveyNo: "324", areaSqm: 9100,  casteCategory: "S.T" },
  { srNo: 6990, districtCaseNo: 18070, nameMarathi: "देवजी रुपजी खरपडे",        nameEnglish: "Devaji Rupaji Kharapade",   surveyNo: "324", areaSqm: 9100,  casteCategory: "S.T" },
  { srNo: 6992, districtCaseNo: 18072, nameMarathi: "सुवणा लक्ष्मण फडवळे",      nameEnglish: "Suvana Lakshman Phadavale", surveyNo: "324", areaSqm: 800,   casteCategory: "S.T" },
  { srNo: 6993, districtCaseNo: 18073, nameMarathi: "ब्रक्ष्मण लहानू खरपडे",    nameEnglish: "Brakshman Lahanu Kharapade",surveyNo: "324", areaSqm: 8000,  casteCategory: "S.T" },
  { srNo: 6994, districtCaseNo: 18074, nameMarathi: "बाबन देऊ धनगर",            nameEnglish: "Baban Deu Dhanagar",        surveyNo: "324", areaSqm: 700,   casteCategory: "S.T" },
  { srNo: 6996, districtCaseNo: 18076, nameMarathi: "रपजी खरपडे",              nameEnglish: "Rapaji Kharapade",          surveyNo: "324", areaSqm: 300,   casteCategory: "S.T" },
  { srNo: 6997, districtCaseNo: 18076, nameMarathi: "अनजी खरपडे",              nameEnglish: "Anaji Kharapade",           surveyNo: "324", areaSqm: 5000,  casteCategory: "S.T" },
  { srNo: 6998, districtCaseNo: 18077, nameMarathi: "बाबूलाल कारेका",           nameEnglish: "Babulal Kareka",            surveyNo: "324", areaSqm: 1000,  casteCategory: "S.T" },
  { srNo: 6999, districtCaseNo: 18078, nameMarathi: "रामचंद्र फडवळे",           nameEnglish: "Ramachandr Phadavale",      surveyNo: "324", areaSqm: 800,   casteCategory: "S.T" },
  { srNo: 7000, districtCaseNo: 18079, nameMarathi: "दसमा बोंगे",              nameEnglish: "Dasama Bonge",              surveyNo: "324", areaSqm: 700,   casteCategory: "S.T" },
  { srNo: 7001, districtCaseNo: 18081, nameMarathi: "विनायक फडके",             nameEnglish: "Vinayak Phadake",           surveyNo: "324", areaSqm: 1000,  casteCategory: "S.T" },
  { srNo: 7005, districtCaseNo: 18085, nameMarathi: "मुन लक्ष्मण कडू",          nameEnglish: "Mun Lakshman Kadu",         surveyNo: "324", areaSqm: 7800,  casteCategory: "S.T" },
  { srNo: 7006, districtCaseNo: 18087, nameMarathi: "रामनी बाबजी दीवा",         nameEnglish: "Ramani Babaji Diva",        surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
  { srNo: 7008, districtCaseNo: 18088, nameMarathi: "गोविद बच्यू नडगे",         nameEnglish: "Govid Bachyu Nadage",       surveyNo: "324", areaSqm: 800,   casteCategory: "S.T" },
  { srNo: 7009, districtCaseNo: 18089, nameMarathi: "बच्यू लाडक्या नडगे",       nameEnglish: "Bachyu Ladakya Nadage",     surveyNo: "324", areaSqm: 700,   casteCategory: "S.T" },
  { srNo: 7010, districtCaseNo: 18090, nameMarathi: "केशव कडू",                nameEnglish: "Keshav Kadu",               surveyNo: "324", areaSqm: 10000, casteCategory: "S.T" },
  { srNo: 7011, districtCaseNo: 18091, nameMarathi: "चंद्रया लक्षा कडू",         nameEnglish: "Chandraya Laksha Kadu",     surveyNo: "324", areaSqm: 800,   casteCategory: "S.T" },
  { srNo: 7012, districtCaseNo: 18092, nameMarathi: "आंब्या मंगळया भोये",       nameEnglish: "Ambya Mangalaya Bhoye",     surveyNo: "324", areaSqm: 5100,  casteCategory: "S.T" },
  { srNo: 7013, districtCaseNo: 18093, nameMarathi: "मधु दिवा",                nameEnglish: "Madhu Diva",                surveyNo: "314", areaSqm: 700,   casteCategory: "S.T" },
  { srNo: 7015, districtCaseNo: 18095, nameMarathi: "रतिलाल देवराम बोंगे",      nameEnglish: "Ratilal Devaram Bonge",     surveyNo: "324", areaSqm: 700,   casteCategory: "S.T" },
  { srNo: 7016, districtCaseNo: 18096, nameMarathi: "नथु रतन गुरव",             nameEnglish: "Nathu Ratan Gurav",         surveyNo: "324", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 7017, districtCaseNo: 18097, nameMarathi: "रतन फडवळे",              nameEnglish: "Ratan Phadavale",           surveyNo: "324", areaSqm: 800,   casteCategory: "S.T" },
  { srNo: 7018, districtCaseNo: 18098, nameMarathi: "काशिनाथ रघ्या कवाड",       nameEnglish: "Kashinath Raghya Kavad",    surveyNo: "324", areaSqm: 100,   casteCategory: "S.T" },
  { srNo: 7019, districtCaseNo: 18099, nameMarathi: "अमृत फडवळे",              nameEnglish: "Amrit Phadavale",           surveyNo: "324", areaSqm: 400,   casteCategory: "S.T" },
  { srNo: 7051, districtCaseNo: 18144, nameMarathi: "लाडक्या धावजी कडु",        nameEnglish: "Ladakya Dhavaji Kadu",      surveyNo: "324", areaSqm: 700,   casteCategory: "S.T" },
  { srNo: 7052, districtCaseNo: 18145, nameMarathi: "लाहण्या लखमा फडवळे",       nameEnglish: "Lahanya Lakhama Phadavale", surveyNo: "324", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 7084, districtCaseNo: 18179, nameMarathi: "संदीप लहानु खरपडे",        nameEnglish: "Sandip Lahanu Kharapade",   surveyNo: "324", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 7085, districtCaseNo: 18180, nameMarathi: "गोविंद रावजी फडवळे",       nameEnglish: "Govind Ravaji Phadavale",   surveyNo: "324", areaSqm: 600,   casteCategory: "S.T" },
  { srNo: 7086, districtCaseNo: 18181, nameMarathi: "चंदु संत्या जाबर",          nameEnglish: "Chandu Santya Jabar",       surveyNo: "324", areaSqm: 8000,  casteCategory: "S.T" },
  { srNo: 7087, districtCaseNo: 18182, nameMarathi: "संगिता वसंत बांबेरे",       nameEnglish: "Sangita Vasant Bambere",    surveyNo: "324", areaSqm: 900,   casteCategory: "S.T" },
  { srNo: 7088, districtCaseNo: 18183, nameMarathi: "सुरेश लाहनू खरपडे",        nameEnglish: "Suresh Lahanu Kharapade",   surveyNo: "324", areaSqm: 1200,  casteCategory: "S.T" },
  { srNo: 7260, districtCaseNo: 22011, nameMarathi: "राजु जत्र्या भावर",         nameEnglish: "Raju Jatrya Bhavar",        surveyNo: "316", areaSqm: 400,   casteCategory: "S.T" },
  { srNo: 7289, districtCaseNo: 22598, nameMarathi: "अंदेश जमना बांगड",         nameEnglish: "Andesh Jamana Bangad",      surveyNo: "324", areaSqm: 200,   casteCategory: "S.T" },
  { srNo: 7293, districtCaseNo: 22602, nameMarathi: "रमेश चंदर कवाड",           nameEnglish: "Ramesh Chandar Kavad",      surveyNo: "326", areaSqm: 600,   casteCategory: "S.T" },
  { srNo: 7517, districtCaseNo: 23139, nameMarathi: "मावंजी फडवळे",             nameEnglish: "Mavanji Phadavale",         surveyNo: "324", areaSqm: 200,   casteCategory: "S.T" },
  { srNo: 7520, districtCaseNo: 23142, nameMarathi: "विष्णू बोगे",             nameEnglish: "Vishnu Boge",               surveyNo: "324", areaSqm: 500,   casteCategory: "S.T" },
  { srNo: 7522, districtCaseNo: 23146, nameMarathi: "सुरेश फडवळे",             nameEnglish: "Suresh Phadavale",          surveyNo: "324", areaSqm: 500,   casteCategory: "S.T" },
  { srNo: 7578, districtCaseNo: 24015, nameMarathi: "रामदास इंद्‌या फडवळे",     nameEnglish: "Ramadas Indya Phadavale",   surveyNo: "324", areaSqm: 4000,  casteCategory: "S.T" },
];

// ── Computed survey summaries with real data ──────────────────────────────────
function computeSurveyStats() {
  const map = new Map<string, { count: number; totalArea: number }>();
  for (const c of claimants) {
    const existing = map.get(c.surveyNo) ?? { count: 0, totalArea: 0 };
    map.set(c.surveyNo, { count: existing.count + 1, totalArea: existing.totalArea + c.areaSqm });
  }
  return map;
}

const surveyStats = computeSurveyStats();

// Map SVG layout positions (% of 800×600 canvas) — matching screenshot layout
// Survey 324 = large central conflicted cluster
const surveyMapPositions: Record<string, { x: number; y: number; w: number; h: number; rotation: number }> = {
  "324": { x: 15, y: 18, w: 54, h: 65, rotation: -4 },
  "316": { x: 4,  y: 20, w: 11, h: 62, rotation: 2  },
  "317": { x: 32, y: 72, w: 14, h: 18, rotation: 1  },
  "326": { x: 4,  y: 74, w: 12, h: 17, rotation: 3  },
  "327": { x: 3,  y: 42, w: 10, h: 22, rotation: 0  },
  "336": { x: 53, y: 76, w: 10, h: 14, rotation: 0  },
  "463": { x: 75, y: 10, w: 14, h: 16, rotation: 5  },
  "224": { x: 26, y: 78, w: 12, h: 14, rotation: -2 },
  "234": { x: 3,  y: 84, w: 9,  h: 9,  rotation: 0  },
  "314": { x: 70, y: 72, w: 9,  h: 9,  rotation: 0  },
  "328": { x: 78, y: 26, w: 12, h: 15, rotation: -3 },
  "14":  { x: 68, y: 58, w: 10, h: 14, rotation: 2  },
};

export const surveySummaries: SurveySummary[] = [
  {
    surveyNumber: "324",
    claimCount: surveyStats.get("324")?.count ?? 116,
    status: "Conflict",
    confidence: 61,
    areaLabel: `${((surveyStats.get("324")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    issue: "Multiple claimant conflict — 116 overlapping claims on single undivided survey number",
    totalAreaSqm: surveyStats.get("324")?.totalArea ?? 0,
    route: "human_review",
    landUseClass: "forest",
    ...(surveyMapPositions["324"]),
  },
  {
    surveyNumber: "316",
    claimCount: surveyStats.get("316")?.count ?? 18,
    status: "Under review",
    confidence: 79,
    areaLabel: `${((surveyStats.get("316")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    issue: "Attribute harmonization — fragmented small parcels",
    totalAreaSqm: surveyStats.get("316")?.totalArea ?? 0,
    route: "human_review",
    landUseClass: "forest",
    ...(surveyMapPositions["316"]),
  },
  {
    surveyNumber: "317",
    claimCount: surveyStats.get("317")?.count ?? 4,
    status: "Verified",
    confidence: 91,
    areaLabel: `${((surveyStats.get("317")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    totalAreaSqm: surveyStats.get("317")?.totalArea ?? 0,
    route: "auto_publish",
    landUseClass: "agricultural",
    ...(surveyMapPositions["317"]),
  },
  {
    surveyNumber: "326",
    claimCount: surveyStats.get("326")?.count ?? 2,
    status: "Verified",
    confidence: 88,
    areaLabel: `${((surveyStats.get("326")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    totalAreaSqm: surveyStats.get("326")?.totalArea ?? 0,
    route: "human_review",
    landUseClass: "homestead",
    ...(surveyMapPositions["326"]),
  },
  {
    surveyNumber: "327",
    claimCount: surveyStats.get("327")?.count ?? 1,
    status: "Verified",
    confidence: 93,
    areaLabel: `${((surveyStats.get("327")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    totalAreaSqm: surveyStats.get("327")?.totalArea ?? 0,
    route: "auto_publish",
    landUseClass: "forest",
    ...(surveyMapPositions["327"]),
  },
  {
    surveyNumber: "336",
    claimCount: surveyStats.get("336")?.count ?? 1,
    status: "Verified",
    confidence: 90,
    areaLabel: `${((surveyStats.get("336")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    totalAreaSqm: surveyStats.get("336")?.totalArea ?? 0,
    route: "auto_publish",
    landUseClass: "agricultural",
    ...(surveyMapPositions["336"]),
  },
  {
    surveyNumber: "463",
    claimCount: surveyStats.get("463")?.count ?? 1,
    status: "Field verification",
    confidence: 72,
    areaLabel: `${((surveyStats.get("463")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    issue: "Boundary at CFR edge — field visit required",
    totalAreaSqm: surveyStats.get("463")?.totalArea ?? 0,
    route: "send_to_surveyor",
    landUseClass: "forest",
    ...(surveyMapPositions["463"]),
  },
  {
    surveyNumber: "224",
    claimCount: surveyStats.get("224")?.count ?? 1,
    status: "Under review",
    confidence: 82,
    areaLabel: `${((surveyStats.get("224")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    issue: "Revenue record mismatch",
    totalAreaSqm: surveyStats.get("224")?.totalArea ?? 0,
    route: "human_review",
    landUseClass: "agricultural",
    ...(surveyMapPositions["224"]),
  },
  {
    surveyNumber: "234",
    claimCount: surveyStats.get("234")?.count ?? 1,
    status: "Verified",
    confidence: 87,
    areaLabel: `${((surveyStats.get("234")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    totalAreaSqm: surveyStats.get("234")?.totalArea ?? 0,
    route: "human_review",
    landUseClass: "homestead",
    ...(surveyMapPositions["234"]),
  },
  {
    surveyNumber: "314",
    claimCount: surveyStats.get("314")?.count ?? 1,
    status: "Verified",
    confidence: 89,
    areaLabel: `${((surveyStats.get("314")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    totalAreaSqm: surveyStats.get("314")?.totalArea ?? 0,
    route: "human_review",
    landUseClass: "other",
    ...(surveyMapPositions["314"]),
  },
  {
    surveyNumber: "328",
    claimCount: surveyStats.get("328")?.count ?? 1,
    status: "Verified",
    confidence: 92,
    areaLabel: `${((surveyStats.get("328")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    totalAreaSqm: surveyStats.get("328")?.totalArea ?? 0,
    route: "auto_publish",
    landUseClass: "forest",
    ...(surveyMapPositions["328"]),
  },
  {
    surveyNumber: "14",
    claimCount: surveyStats.get("14")?.count ?? 1,
    status: "Field verification",
    confidence: 68,
    areaLabel: `${((surveyStats.get("14")?.totalArea ?? 0) / 10000).toFixed(1)} ha total`,
    issue: "Boundary coordinates unconfirmed",
    totalAreaSqm: surveyStats.get("14")?.totalArea ?? 0,
    route: "send_to_surveyor",
    landUseClass: "forest",
    ...(surveyMapPositions["14"]),
  },
];

export const ozarDataset = {
  village: "Ozar Village",
  taluka: "Jawhar / Mokhada Taluka",
  district: "Palghar District, Maharashtra",
  totalClaims: claimants.length,
  uniqueSurveys: surveySummaries.length,
  sourceName: "Ozar Village Forest Rights Register (CFR)",
  sourceType: "CSV attribute register",
  sourceNote: "Attribute data from Ozar_Village_Dataset_final_f.csv (Palghar District) · Boundary geometry is georeferenced to WGS84 coordinates.",
  centroidLat: 19.928,
  centroidLng: 73.221,
};

export const processingSteps = [
  { label: "Dataset quality analysis",    state: "Completed",  detail: `${claimants.length} source rows recognized — quality band: high` },
  { label: "CV boundary segmentation",    state: "Completed",  detail: "12 survey geometries segmented — IoU ≥ 0.75" },
  { label: "Coordinate harmonization",    state: "Completed",  detail: "Everest 1830 → WGS84 transform applied" },
  { label: "Parcel subdivision (GNN)",    state: "Processing", detail: "Survey 324 — 116 sub-parcel nodes queued" },
  { label: "Spatial record matching",     state: "Processing", detail: "7/12 Utara fuzzy-match in progress" },
  { label: "Conflict detection",          state: "Completed",  detail: "Survey No. 324 cluster flagged — 116 claims" },
  { label: "Confidence scoring",          state: "Processing", detail: "Weighted AI review in progress (conf: 61%)" },
  { label: "Golden record creation",      state: "Pending",    detail: "Requires officer approval — human_review route" },
];

export const recentActivity = [
  { time: "09:41", label: `${claimants.length} claim records ingested`, detail: "Ozar Village register · all S.T. category" },
  { time: "09:38", label: "Conflict cluster detected",  detail: "Survey No. 324 · 116 linked claims" },
  { time: "09:32", label: "AI harmonization completed", detail: "11 lower-density survey groups verified" },
  { time: "09:18", label: "Boundary layer prepared",    detail: "Illustrative geometry generated from CFR data" },
  { time: "09:05", label: "BhumiNaksha pipeline started", detail: "Bhumi-Nakasha v1 · 8-stage GeoAI engine" },
];

// Helper: get claimants for a specific survey number
export function getClaimantsBySurvey(surveyNo: string): Claimant[] {
  return claimants.filter((c) => c.surveyNo === surveyNo);
}

// Helper: route badge text
export function routeBadge(route: RouteDecision): string {
  if (route === "auto_publish")   return "🟢 Auto-Published";
  if (route === "human_review")   return "🟡 Officer Review";
  return "🔴 Send to Surveyor";
}

// NL query simulation
export function simulateNLResponse(query: string, surveyNo: string): string {
  const q = query.toLowerCase();
  const summary = surveySummaries.find((s) => s.surveyNumber === surveyNo);
  const cList = getClaimantsBySurvey(surveyNo);

  if (q.includes("area") || q.includes("क्षेत्र") || q.includes("हेक्टर")) {
    const ha = summary ? (summary.totalAreaSqm / 10000).toFixed(2) : "—";
    return `Survey No. ${surveyNo} has a total declared area of ${ha} hectares across ${cList.length} claims.`;
  }
  if (q.includes("conflict") || q.includes("dispute") || q.includes("विवाद")) {
    if (surveyNo === "324") return "Survey No. 324 has a critical multi-claimant conflict — 116 overlapping claims share this single undivided survey number. Officer sign-off required before Golden Record creation.";
    return `Survey No. ${surveyNo} has no active conflict flags. Confidence: ${summary?.confidence ?? "—"}%.`;
  }
  if (q.includes("owner") || q.includes("claimant") || q.includes("मालक")) {
    const names = cList.slice(0, 3).map((c) => c.nameEnglish).join(", ");
    return `Survey No. ${surveyNo} has ${cList.length} registered claimants. First few: ${names}${cList.length > 3 ? ` and ${cList.length - 3} more` : ""}.`;
  }
  if (q.includes("confidence") || q.includes("score") || q.includes("विश्वास")) {
    return `Bhumi-Nakasha confidence score for Survey No. ${surveyNo}: ${summary?.confidence ?? "—"}%. Route decision: ${summary ? routeBadge(summary.route) : "—"}.`;
  }
  if (q.includes("status") || q.includes("स्थिती")) {
    return `Survey No. ${surveyNo} status: ${summary?.status ?? "Unknown"}. ${summary?.issue ?? "No issues flagged"}.`;
  }
  return `Survey No. ${surveyNo} — ${cList.length} claimants, ${summary?.confidence ?? "—"}% confidence, status: ${summary?.status ?? "Unknown"}. Ask me about area, claimants, conflicts, or confidence scores.`;
}