// Radiology shorthand and British/American spellings, so "RML collapse", "hemorrhage" and "SUFE" find the notes
// that say "right middle lobe", "haemorrhage" and "slipped upper femoral epiphysis". Used by AI retrieval and search.

/** Abbreviation (lowercase) → what it stands for. Modalities (CT, MRI, US) are left out on purpose: they are everywhere and only add noise. */
export const ABBR: Record<string, string[]> = {
  // chest
  rul: ['right upper lobe'], rml: ['right middle lobe'], rll: ['right lower lobe'], lul: ['left upper lobe'], lll: ['left lower lobe'],
  pe: ['pulmonary embolism'], ctpa: ['ct pulmonary angiography'], hrct: ['high resolution ct'], ptx: ['pneumothorax'],
  uip: ['usual interstitial pneumonia'], nsip: ['nonspecific interstitial pneumonia'], cop: ['cryptogenic organising pneumonia'], ild: ['interstitial lung disease'],
  ipf: ['idiopathic pulmonary fibrosis'], copd: ['chronic obstructive pulmonary disease'], ards: ['acute respiratory distress syndrome'],
  lam: ['lymphangioleiomyomatosis'], lch: ['langerhans cell histiocytosis'], pcp: ['pneumocystis pneumonia'], tb: ['tuberculosis'],
  abpa: ['allergic bronchopulmonary aspergillosis'], spn: ['solitary pulmonary nodule'], cpam: ['congenital pulmonary airway malformation'],
  ccam: ['congenital cystic adenomatoid malformation'], cdh: ['congenital diaphragmatic hernia'], rds: ['respiratory distress syndrome'],
  ttn: ['transient tachypnoea of the newborn'], mas: ['meconium aspiration syndrome'], bpd: ['bronchopulmonary dysplasia'],
  // heart and vessels
  tof: ['tetralogy of fallot'], asd: ['atrial septal defect'], vsd: ['ventricular septal defect'], pda: ['patent ductus arteriosus'],
  tga: ['transposition of the great arteries'], tapvr: ['total anomalous pulmonary venous return'], hocm: ['hypertrophic cardiomyopathy'],
  lge: ['late gadolinium enhancement'], aaa: ['abdominal aortic aneurysm'], dvt: ['deep vein thrombosis'], ivc: ['inferior vena cava'],
  svc: ['superior vena cava'], avm: ['arteriovenous malformation'], avf: ['arteriovenous fistula'], ica: ['internal carotid artery'],
  mca: ['middle cerebral artery'], aca: ['anterior cerebral artery'], pca: ['posterior cerebral artery'], sma: ['superior mesenteric artery'],
  ima: ['inferior mesenteric artery'], smv: ['superior mesenteric vein'], tips: ['transjugular intrahepatic portosystemic shunt'],
  // neuro and head and neck
  sah: ['subarachnoid haemorrhage'], sdh: ['subdural haematoma'], edh: ['extradural haematoma', 'epidural haematoma'], ich: ['intracerebral haemorrhage'],
  ivh: ['intraventricular haemorrhage'], gmh: ['germinal matrix haemorrhage'], hie: ['hypoxic ischaemic encephalopathy'], pvl: ['periventricular leukomalacia'],
  dwi: ['diffusion weighted imaging'], adc: ['apparent diffusion coefficient'], swi: ['susceptibility weighted imaging'], flair: ['fluid attenuated inversion recovery'],
  ms: ['multiple sclerosis', 'mitral stenosis'], adem: ['acute disseminated encephalomyelitis'], pml: ['progressive multifocal leukoencephalopathy'],
  cjd: ['creutzfeldt jakob disease'], gbm: ['glioblastoma'], pres: ['posterior reversible encephalopathy syndrome'], nph: ['normal pressure hydrocephalus'],
  cpa: ['cerebellopontine angle'], iac: ['internal auditory canal'], nf1: ['neurofibromatosis type 1'], nf2: ['neurofibromatosis type 2'],
  nf: ['neurofibromatosis'], tsc: ['tuberous sclerosis'], vhl: ['von hippel lindau'], csf: ['cerebrospinal fluid'], tia: ['transient ischaemic attack'],
  // abdomen
  hcc: ['hepatocellular carcinoma'], fnh: ['focal nodular hyperplasia'], mrcp: ['magnetic resonance cholangiopancreatography'],
  ercp: ['endoscopic retrograde cholangiopancreatography'], psc: ['primary sclerosing cholangitis'], pbc: ['primary biliary cholangitis'],
  bcs: ['budd chiari syndrome'], sbo: ['small bowel obstruction'], ibd: ['inflammatory bowel disease'], uc: ['ulcerative colitis'],
  gist: ['gastrointestinal stromal tumour'], nec: ['necrotising enterocolitis'], ihps: ['infantile hypertrophic pyloric stenosis'],
  ipmn: ['intraductal papillary mucinous neoplasm'], mcn: ['mucinous cystic neoplasm'], spen: ['solid pseudopapillary neoplasm'],
  // genitourinary and obstetrics
  rcc: ['renal cell carcinoma'], tcc: ['transitional cell carcinoma'], aml: ['angiomyolipoma'], adpkd: ['autosomal dominant polycystic kidney disease'],
  arpkd: ['autosomal recessive polycystic kidney disease'], pkd: ['polycystic kidney disease'], vur: ['vesicoureteric reflux'], puv: ['posterior urethral valves'],
  mcug: ['micturating cystourethrogram'], vcug: ['voiding cystourethrogram'], ivu: ['intravenous urogram'], hsg: ['hysterosalpingography'],
  puj: ['pelviureteric junction'], upj: ['ureteropelvic junction'], vuj: ['vesicoureteric junction'], pid: ['pelvic inflammatory disease'],
  pcos: ['polycystic ovary syndrome'], iugr: ['intrauterine growth restriction'], nt: ['nuchal translucency'], gtd: ['gestational trophoblastic disease'],
  // musculoskeletal
  acl: ['anterior cruciate ligament'], pcl: ['posterior cruciate ligament'], mcl: ['medial collateral ligament'], lcl: ['lateral collateral ligament'],
  avn: ['avascular necrosis'], ddh: ['developmental dysplasia of the hip'], sufe: ['slipped upper femoral epiphysis'], scfe: ['slipped capital femoral epiphysis'],
  oi: ['osteogenesis imperfecta'], ra: ['rheumatoid arthritis'], oa: ['osteoarthritis'], as: ['ankylosing spondylitis'], dish: ['diffuse idiopathic skeletal hyperostosis'],
  cppd: ['calcium pyrophosphate deposition'], hadd: ['hydroxyapatite deposition disease'], nai: ['non accidental injury'], abc: ['aneurysmal bone cyst'],
  ubc: ['unicameral bone cyst'], gct: ['giant cell tumour'], nof: ['non ossifying fibroma'], fd: ['fibrous dysplasia'],
  // breast, endocrine, oncology
  dcis: ['ductal carcinoma in situ'], idc: ['invasive ductal carcinoma'], ilc: ['invasive lobular carcinoma'], birads: ['bi-rads breast imaging reporting'],
  tirads: ['ti-rads thyroid imaging reporting'], lirads: ['li-rads liver imaging reporting'], pirads: ['pi-rads prostate imaging reporting'],
  ptc: ['papillary thyroid carcinoma'], men: ['multiple endocrine neoplasia'], nhl: ['non hodgkin lymphoma'], fdg: ['fluorodeoxyglucose'],
  hu: ['hounsfield units'],
};

/** Long form → abbreviation, for notes that only use the short form. */
const LONG: [string, string][] = Object.entries(ABBR).flatMap(([a, ls]) => ls.map((l) => [l, a] as [string, string]));

// [British, American]. Matched inside words, so "lymphoedema" and "haemangioma" are covered too.
const SPELL: [string, string][] = [
  ['haem', 'hem'], ['oedema', 'edema'], ['oesophag', 'esophag'], ['paediatr', 'pediatr'], ['ischaem', 'ischem'], ['anaem', 'anem'], ['leukaem', 'leukem'],
  ['foet', 'fet'], ['tumour', 'tumor'], ['oestrogen', 'estrogen'], ['diarrhoea', 'diarrhea'], ['orthopaed', 'orthoped'], ['gynaecolog', 'gynecolog'],
  ['coeliac', 'celiac'], ['caesarean', 'cesarean'], ['aetiolog', 'etiolog'], ['dyspnoea', 'dyspnea'], ['apnoea', 'apnea'], ['tachypnoea', 'tachypnea'],
  ['sulph', 'sulf'], ['fibre', 'fiber'], ['centre', 'center'], ['colour', 'color'], ['organis', 'organiz'], ['haematoma', 'hematoma'],
];
// American stems that are also the start of unrelated words.
const NOT_US = [/^hemi/, /^fet(?!a|u)/];

/** The other spelling of a word, if it has one. */
export function spellVariants(word: string): string[] {
  const w = word.toLowerCase(), out = new Set<string>();
  for (const [uk, us] of SPELL) {
    if (w.includes(uk)) out.add(w.replace(uk, us));
    else if (w.includes(us) && !NOT_US.some((r) => r.test(w)) && (us.length > 3 || w.startsWith(us))) out.add(w.replace(us, uk));
  }
  out.delete(w);
  return [...out];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const has = (text: string, phrase: string) => new RegExp(`\\b${esc(phrase)}\\b`).test(text);

/** Extra search terms for a query: what its abbreviations stand for, abbreviations of its long forms, and other spellings.
 *  Two-letter abbreviations only count in capitals ("MS", not "ms"), so ordinary words are left alone. */
export function expansions(q: string): string[] {
  const low = q.toLowerCase(), out = new Set<string>();
  for (const t of q.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
    const k = t.toLowerCase();
    if (ABBR[k] && (k.length >= 3 || (t.length >= 2 && t === t.toUpperCase()))) ABBR[k].forEach((e) => out.add(e));
    spellVariants(k).forEach((v) => out.add(v));
  }
  for (const [l, a] of LONG) if (has(low, l)) out.add(a);
  return [...out].filter((x) => !has(low, x));
}

/** The query with its expansions appended (unchanged when there are none). */
export const expandQuery = (q: string) => { const x = expansions(q); return x.length ? `${q} ${x.join(' ')}` : q; };
