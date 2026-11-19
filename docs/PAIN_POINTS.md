# Why internship search is cumbersome — and what HORIZON does about it

Research notes behind HORIZON's design (compiled 18–19 November 2026). LinkedIn, Internshala, Naukri and Unstop are useful platforms with millions of genuine opportunities; the points below are the recurring frictions students describe, the platforms' own warnings, and published survey data. Sources are listed at the end. Figures are quoted as published by their authors and are mostly from US/UK/European samples — they indicate the scale of a problem, not Indian internship statistics.

## 1. You cannot tell whether a listing is real

- **Ghost jobs.** Greenhouse reports that 18–22% of jobs posted on its platform in a given quarter are "ghost jobs" (advertised with no intent to hire), and three in five candidates say they suspect they have met one [1][2]. An analysis by ResumeUp.AI, reported by Entrepreneur, estimated that 27.4% of US LinkedIn listings were likely ghost jobs [3][4].
- **Fee scams.** Fraudulent internships ask for "registration", "training" or "security deposit" fees. Internshala's own guidance tells students to report any employer asking for money [5], and Naukri states that genuine recruiters never charge to schedule interviews or offer jobs [6]. Government and cyber-safety advisories describe the same pattern spreading through Telegram, WhatsApp and Instagram [7].
- **The burden sits with the student.** Internshala notes that although it verifies postings, "no platform can be 100% scam-free" [8]. Open portals mostly warn and react after a report.

**HORIZON:** listings are reviewed before publication; admin-curated listings carry the original source link and a "last verified" date; every recruiter signs a no-fee pledge on every listing; fee demands are an *urgent* grievance category with a 72-hour target; expired listings are archived automatically; all demo content is labelled "Illustrative listing".

## 2. You cannot tell who is on the other side

- Scammers impersonate real recruiters and well-known companies, using personal email addresses and copied profiles [9][10]. Naukri's own security advice flags offers from free-mail addresses such as `company@gmail.com` [11].
- Recruiters face the mirror problem: no assurance that an applicant is really enrolled where they claim.

**HORIZON — verification on both sides:**
- *Students:* email one-time code + institutional domain match (auto-approval only for domains confirmed for that institution), otherwise a student-ID upload reviewed by an administrator. Only institutions on the Ministry of Education list of Institutions of National Importance are accepted; anything else stays "unverified" until checked against an official source.
- *Recruiters:* free-mail providers are refused; the work-email domain must match an existing organisation's domain, or is checked against a new organisation's official website; an authorisation/registration document is reviewed; a recruiter can only be approved once their organisation is verified. Only verified organisations can receive applications on HORIZON.

## 3. Applications disappear into a black hole

- 61% of job seekers in Greenhouse's 2024 survey (US, UK, Germany) said they had been ghosted after an interview [12]; Greenhouse found only 4% of companies on its platform contacted all rejected applicants in Q2 2024 [13].

**HORIZON:** verified recruiters commit to a first response within 14 days; overdue applicants are highlighted on the recruiter dashboard; declining a candidate *requires* a short reason that the student sees; each organisation's response rate is shown on its listings once there is enough data; every recruiter update syncs to the student's Kanban tracker and notifications.

## 4. Recruiters cannot trust the CVs they receive

Copied CVs, mismatched names and unreadable scans slow screening and push recruiters towards brand-name shortcuts.

**HORIZON — resume validation pipeline** (`server/services/resume-validator.js`):
1. *Critical checks (reject the upload):* real PDF signature, no active content (JavaScript, launch actions, embedded files), not encrypted, opens cleanly, ≤4 pages, has a machine-readable text layer.
2. *Authenticity checks (flag for manual review; hidden from recruiters until cleared):* name matches the verified account, mentions the verified institution, file not already linked to another account.
3. *Quality checks (suggestions):* graduation year, contact email, core sections, ideal length.
Students see the full report; administrators can mark a CV "HORIZON-verified" or request changes. Video resumes (≤120 s, ≤50 MB, type checked from file contents) are moderated before anyone else can see them.

## 5. International opportunities are hard to filter

Mainstream Indian portals are built around domestic roles; visa sponsorship, stipend currency and eligibility for Indian students are rarely searchable. Unstop is strongest for competitions, hackathons and hiring challenges [14][15], with some extras behind a paid subscription [16].

**HORIZON:** filters for country, visa sponsorship, paid/unpaid, compensation (with an indicative USD equivalent for comparison), duration, deadline, level and year of study; country guides that link only to official government sources and show a last-updated date, with a clear "not legal advice" notice.

## 6. Complaints go nowhere

User-posted complaints about job portals frequently describe reports that received no visible action [17]. (These are unverified individual posts, cited only as evidence of the perceived gap.)

**HORIZON — grievance redressal modelled on India's IT Rules timelines:** the IT Rules, 2021 require intermediaries' grievance officers to acknowledge complaints within 24 hours and resolve them within 15 days, with an appeal to a Grievance Appellate Committee within 30 days [18][19]. HORIZON applies the same clock to every ticket: ticket number on submission, 24-hour acknowledgement, 15-day resolution (72 hours for fee demands and harassment), the respondent organisation's right to reply, escalation to a named Grievance Officer (Level 2) if a deadline is missed or within 30 days of a decision, reopening within 7 days, satisfaction feedback, guest filing with a private tracking key, and a public transparency report with aggregate figures only. External avenues (cybercrime.gov.in / 1930, consumer helpline, the institution's placement cell) are always shown.

---

## Sources

1. Greenhouse — *2024 State of Job Hunting report* (UK edition: 18–22% ghost jobs per quarter). https://www.greenhouse.com/uk/blog/greenhouse-2024-state-of-job-hunting-report
2. Greenhouse — *2024 State of Job Hunting report* (press release, 11 Dec 2024). https://prnewswire.com/news-releases/anxious-yet-undeterred-48-of-us-workers-surveyed-say-they-are-on-the-job-hunt-despite-hurdles-like-phantom-jobs-ghosting-bias-and-ai-bot-vs-bot-market-302327722.html
3. Entrepreneur — *One quarter of jobs posted online are fake "ghost jobs": study* (ResumeUp.AI analysis of LinkedIn postings). https://www.entrepreneur.com/business-news/one-quarter-of-jobs-posted-online-are-fake-ghost-jobs/496683
4. The Interview Guys — *Ghost Jobs Exposed* (summary of ResumeUp.AI's 27.4% figure). https://blog.theinterviewguys.com/ghost-jobs-exposed/
5. Internshala — *8 things to take care of while applying for internships and jobs on Internshala*. https://internshala.com/blog/2021/10/8-things-to-take-care-of-while-applying-to-internships-and-jobs-on-internshala/
6. Naukri — *Do I need to pay to apply to a job or get an interview call?* https://www.naukri.com/faq/job-seeker-search-do-i-need-to-pay-to-apply-to-a-job-or-get-an-interview-call%3F-/-recruiters-are-asking-me-to-pay-to-schedule-interview-for-job%3F
7. Vikaspedia — *Fake internship scams: a growing threat for students*. https://en.vikaspedia.in/viewcontent/education/digital-litercy/information-security/being-safe-online-1/fake-internship-scams-a-growing-threat-for-students?lgn=en
8. Internshala — *How to spot fake companies at Internshala*. https://internshala.com/blog/how-to-spot-fake-companies-at-internshala/
9. Business Today — *Beware! Fake recruiters are targeting desperate job hunters* (20 Apr 2026). https://www.businesstoday.in/technology/story/beware-fake-recruiters-are-targeting-desperate-job-hunters-526460-2026-04-20
10. Naukri — *How to avoid job search scams*. https://www.naukri.com/blog/how-to-avoid-job-search-scams/
11. Naukri — *Security advice*. https://naukricom.freshdesk.com/support/solutions/articles/228223-security-advice
12. Greenhouse — *Ghosting, ghost jobs and bots* (2024 State of Job Hunting). https://www.greenhouse.com/blog/greenhouse-2024-state-of-job-hunting-report
13. Axios — *How Greenhouse is taking on job ghosting* (24 Sep 2024). https://www.axios.com/2024/09/24/greenhouse-job-ghosting-hiring-rejection-email
14. YourStory — *Unstop is building India's largest early-talent hiring engine* (Dec 2025). https://yourstory.com/2025/12/unstopai-is-building-indias-largest-early-talent-hiring-engine
15. Inc42 — *How this startup is blending Naukri & LinkedIn playbooks*. https://inc42.com/startups/how-this-startup-is-blending-naukri-linkedin-playbooks-to-transform-indias-job-market
16. Outlook Startup — *Unstop launches subscription membership Unstop Pro*. https://startup.outlookindia.com/sector/saas/unstop-launches-subscription-membership-unstop-pro-news-9537
17. ConsumerComplaints.in — user-posted Internshala complaints (unverified). https://www.consumercomplaints.in/bycompany/internshala-a594279.html
18. The Leaflet — summary of the IT (Intermediary Guidelines) Amendment Rules, 2022 (24 h / 15 days; GAC appeal within 30 days). https://theleaflet.in/?p=47687
19. ThePrint — *New amendments to IT Rules: govt-appointed grievance panel*. https://theprint.in/india/governance/new-amendments-to-it-rules-govt-appointed-grievance-panel-stricter-compliance-for-social-media/1186094
