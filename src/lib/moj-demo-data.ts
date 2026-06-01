/** Statični podatki za predogled moj.visionone.si na vms.visionone.si */

export const demoClient = {
  name: "Demo Logistika d.o.o.",
  address: "Industrijska cesta 12, 2000 Maribor",
  contact: "Marko Novak",
  phone: "+386 41 234 567",
  email: "marko@demo-logistika.si",
  packageName: "Vzdrževalni paket Standard",
  packageDescription: "Redni obiski, čiščenje kamer, prioritetni odziv v delovnem času.",
};

export const demoReminders = [
  { id: "1", title: "Čiščenje zunanjih kamer", dueDate: "2026-06-15", kind: "Čiščenje kamer" },
  { id: "2", title: "Letni pregled snemalnika", dueDate: "2026-07-02", kind: "Servis" },
];

export const demoRequests = [
  { id: "1", title: "Menjava kamere pri vhodu", status: "V teku", description: "Slika v nočnem načinu zamegljena.", updatedAt: "2026-05-28" },
  { id: "2", title: "Dostop za servisni obisk", status: "Prejeto", description: "Prosim za termin v petek dopoldne.", updatedAt: "2026-05-26" },
];
