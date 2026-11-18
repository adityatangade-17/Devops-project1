-- 064: EPR service catalogue bulk import (58 draft booking pages).
--
-- Seeds booking_services from epr-service-catalogue-onboarding.csv as DRAFT
-- pages (active=FALSE). Idempotent: ON CONFLICT (slug) DO NOTHING, so re-running
-- never clobbers an admin's later edits and a service already created by hand
-- is left untouched. All rows are 30-minute round-robin consultations; an admin
-- must attach eligible consultants and Publish before a page goes live (the API
-- refuses to activate a service with no consultants).

INSERT INTO coexistence.booking_services
  (name, slug, description, duration_minutes, assignment_policy, active)
VALUES
  ('EPR Registration','epr-registration','Book a 30-minute consultation about EPR Registration. Category: environmental compliance.',30,'round_robin',FALSE),
  ('CDSCO','cdsco','Book a 30-minute consultation about CDSCO. Category: product and health compliance.',30,'round_robin',FALSE),
  ('AEO','aeo','Book a 30-minute consultation about AEO. Category: trade and customs.',30,'round_robin',FALSE),
  ('BIS','bis','Book a 30-minute consultation about BIS. Category: product compliance.',30,'round_robin',FALSE),
  ('ARAI Approval','arai-approval','Book a 30-minute consultation about ARAI Approval. Category: automotive compliance.',30,'round_robin',FALSE),
  ('ISO Certificate','iso-certificate','Book a 30-minute consultation about ISO Certificate. Category: management systems.',30,'round_robin',FALSE),
  ('STQC Certification','stqc-certification','Book a 30-minute consultation about STQC Certification. Category: technology compliance.',30,'round_robin',FALSE),
  ('LMPC Certification','lmpc-certification','Book a 30-minute consultation about LMPC Certification. Category: product compliance.',30,'round_robin',FALSE),
  ('ISI Certification','isi-certification','Book a 30-minute consultation about ISI Certification. Category: product compliance.',30,'round_robin',FALSE),
  ('FMCS Certification','fmcs-certification','Book a 30-minute consultation about FMCS Certification. Category: product compliance.',30,'round_robin',FALSE),
  ('CRS Certification','crs-certification','Book a 30-minute consultation about CRS Certification. Category: product compliance.',30,'round_robin',FALSE),
  ('ESIC Registration','esic-registration','Book a 30-minute consultation about ESIC Registration. Category: employment compliance.',30,'round_robin',FALSE),
  ('EPF Registration','epf-registration','Book a 30-minute consultation about EPF Registration. Category: employment compliance.',30,'round_robin',FALSE),
  ('NBFC','nbfc','Book a 30-minute consultation about NBFC. Category: financial regulatory.',30,'round_robin',FALSE),
  ('FFMC','ffmc','Book a 30-minute consultation about FFMC. Category: financial regulatory.',30,'round_robin',FALSE),
  ('GST','gst','Book a 30-minute consultation about GST. Category: tax and business registration.',30,'round_robin',FALSE),
  ('MSME','msme','Book a 30-minute consultation about MSME. Category: tax and business registration.',30,'round_robin',FALSE),
  ('FCRA','fcra','Book a 30-minute consultation about FCRA. Category: financial regulatory.',30,'round_robin',FALSE),
  ('PRO','pro','Book a 30-minute consultation about PRO. Category: environmental compliance.',30,'round_robin',FALSE),
  ('DPCC','dpcc','Book a 30-minute consultation about DPCC. Category: environmental compliance.',30,'round_robin',FALSE),
  ('CGWA','cgwa','Book a 30-minute consultation about CGWA. Category: environmental compliance.',30,'round_robin',FALSE),
  ('FSSAI','fssai','Book a 30-minute consultation about FSSAI. Category: food compliance.',30,'round_robin',FALSE),
  ('BARCODE','barcode','Book a 30-minute consultation about BARCODE. Category: product and trade.',30,'round_robin',FALSE),
  ('PSARA','psara','Book a 30-minute consultation about PSARA. Category: sector regulatory.',30,'round_robin',FALSE),
  ('WPC','wpc','Book a 30-minute consultation about WPC. Category: technology compliance.',30,'round_robin',FALSE),
  ('RBI/FEMA','rbi-fema','Book a 30-minute consultation about RBI/FEMA. Category: financial regulatory.',30,'round_robin',FALSE),
  ('CFO','cfo','Book a 30-minute consultation about CFO. Category: environmental compliance.',30,'round_robin',FALSE),
  ('IEC','iec','Book a 30-minute consultation about IEC. Category: trade and customs.',30,'round_robin',FALSE),
  ('RERA','rera','Book a 30-minute consultation about RERA. Category: sector regulatory.',30,'round_robin',FALSE),
  ('TEC','tec','Book a 30-minute consultation about TEC. Category: technology compliance.',30,'round_robin',FALSE),
  ('AERB','aerb','Book a 30-minute consultation about AERB. Category: sector regulatory.',30,'round_robin',FALSE),
  ('NSIC','nsic','Book a 30-minute consultation about NSIC. Category: business registration.',30,'round_robin',FALSE),
  ('BEE','bee','Book a 30-minute consultation about BEE. Category: product and energy compliance.',30,'round_robin',FALSE),
  ('RCMC','rcmc','Book a 30-minute consultation about RCMC. Category: trade and customs.',30,'round_robin',FALSE),
  ('IPR','ipr','Book a 30-minute consultation about IPR. Category: intellectual property.',30,'round_robin',FALSE),
  ('GeM','gem','Book a 30-minute consultation about GeM. Category: government procurement.',30,'round_robin',FALSE),
  ('CSR','csr','Book a 30-minute consultation about CSR. Category: sustainability and governance.',30,'round_robin',FALSE),
  ('ESG','esg','Book a 30-minute consultation about ESG. Category: sustainability and governance.',30,'round_robin',FALSE),
  ('EIA','eia','Book a 30-minute consultation about EIA. Category: environmental compliance.',30,'round_robin',FALSE),
  ('ESDD','esdd','Book a 30-minute consultation about ESDD. Category: sustainability and governance.',30,'round_robin',FALSE),
  ('CPCB','cpcb','Book a 30-minute consultation about CPCB. Category: environmental compliance.',30,'round_robin',FALSE),
  ('ETA','eta','Book a 30-minute consultation about ETA. Category: technology compliance.',30,'round_robin',FALSE),
  ('RNI','rni','Book a 30-minute consultation about RNI. Category: media and publication regulatory.',30,'round_robin',FALSE),
  ('MPEDA','mpeda','Book a 30-minute consultation about MPEDA. Category: trade and food compliance.',30,'round_robin',FALSE),
  ('APEDA','apeda','Book a 30-minute consultation about APEDA. Category: trade and food compliance.',30,'round_robin',FALSE),
  ('PESO','peso','Book a 30-minute consultation about PESO. Category: sector regulatory.',30,'round_robin',FALSE),
  ('AGMARK','agmark','Book a 30-minute consultation about AGMARK. Category: food and agriculture compliance.',30,'round_robin',FALSE),
  ('LLP','llp','Book a 30-minute consultation about LLP. Category: business registration.',30,'round_robin',FALSE),
  ('HALLMARK / TRADEMARK','hallmark-trademark','Book a 30-minute consultation about HALLMARK / TRADEMARK. Category: product and intellectual property.',30,'round_robin',FALSE),
  ('CE MARKING CERTIFICATION','ce-marking-certification','Book a 30-minute consultation about CE MARKING CERTIFICATION. Category: product compliance.',30,'round_robin',FALSE),
  ('BIFMA','bifma','Book a 30-minute consultation about BIFMA. Category: product compliance.',30,'round_robin',FALSE),
  ('CMMI','cmmi','Book a 30-minute consultation about CMMI. Category: management systems.',30,'round_robin',FALSE),
  ('GMP','gmp','Book a 30-minute consultation about GMP. Category: product and health compliance.',30,'round_robin',FALSE),
  ('ORGANIC','organic','Book a 30-minute consultation about ORGANIC. Category: food and agriculture compliance.',30,'round_robin',FALSE),
  ('GOTS','gots','Book a 30-minute consultation about GOTS. Category: product and textile compliance.',30,'round_robin',FALSE),
  ('HACCP','haccp','Book a 30-minute consultation about HACCP. Category: food compliance.',30,'round_robin',FALSE),
  ('KOSHER','kosher','Book a 30-minute consultation about KOSHER. Category: food compliance.',30,'round_robin',FALSE),
  ('ROHS','rohs','Book a 30-minute consultation about ROHS. Category: product and electronics compliance.',30,'round_robin',FALSE)
ON CONFLICT (slug) DO NOTHING;
