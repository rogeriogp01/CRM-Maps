import { NextResponse } from "next/server";
import { chromium } from "playwright-core";

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { query, location } = await request.json();

  if (!query || !location) {
    return NextResponse.json({ error: "Termo de busca e localização são obrigatórios" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let browser;
      try {
        browser = await chromium.launch({ 
          headless: true 
        });
        
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 800 }
        });

        const page = await context.newPage();
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query + ' ' + location)}`;
        
        console.log(`Iniciando varredura: ${searchUrl}`);
        
        // Aumentar timeout e mudar estratégia de espera para carregar mais rápido
        try {
          await page.goto(searchUrl, { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
          });
          // Esperar um pouco mais para garantir que os resultados comecem a carregar
          await page.waitForSelector('div[role="article"]', { timeout: 10000 }).catch(() => console.log("Timeout esperando seletor de leads, mas continuando..."));
        } catch (gotoError) {
          console.error("Erro no goto:", gotoError);
          // Se der timeout mas a página carregou o básico, tentamos continuar
        }

        // Check for CAPTCHA
        const isCaptcha = await page.$('iframe[src*="recaptcha"]');
        if (isCaptcha) {
          controller.enqueue(encoder.encode(JSON.stringify({ error: "CAPTCHA detectado! Por favor, resolva manualmente ou tente mais tarde.", type: 'captcha' }) + "\n"));
          await browser.close();
          controller.close();
          return;
        }

        const leads = new Set();
        let scrollCount = 0;
        const maxScrolls = 10; // Limite de scrolls para evitar loop infinito em demonstração

        while (scrollCount < maxScrolls) {
          console.log(`Scroll ${scrollCount + 1}/${maxScrolls}...`);
          
          // Extrair dados da página atual
          const results = await page.evaluate(() => {
            // Seletores mais genéricos para aumentar chance de sucesso
            const items = Array.from(document.querySelectorAll('div[role="article"], a[href*="/maps/place/"]'));
            
            return items.map(item => {
              // Tentar múltiplos seletores para o nome
              const name = item.querySelector('.fontHeadlineSmall, .qS9S7f, [aria-label]')?.getAttribute('aria-label') || 
                           item.querySelector('.fontHeadlineSmall, .qS9S7f')?.textContent?.trim() || "";
              
              // Tentar pegar o endereço e categoria (geralmente são os primeiros blocos de texto)
              const bodyTexts = Array.from(item.querySelectorAll('.fontBodyMedium, .W4P4ne, .lI9IFe')).map(el => el.textContent?.trim());
              const category = bodyTexts[0] || "";
              const address = bodyTexts[1] || "";
              
              // Tentar pegar o telefone via aria-label ou regex no texto
              const phoneElement = item.querySelector('button[data-value*="phone"], [aria-label*="Telefone"], [aria-label*="Phone"]');
              let phone = phoneElement?.getAttribute('data-value')?.replace('phone:', '') || 
                          phoneElement?.getAttribute('aria-label')?.replace(/[^0-9+]/g, '') || "";
              
              if (!phone) {
                const text = item.textContent || "";
                const phoneMatch = text.match(/(\(?\d{2}\)?\s?\d{4,5}-?\d{4})/);
                phone = phoneMatch ? phoneMatch[0] : "";
              }

              return { name, phone, address, category };
            }).filter(item => item.name.length > 0);
          });

          console.log(`Encontrados ${results.length} possíveis leads no scroll ${scrollCount + 1}`);

          // Processar e enviar novos leads encontrados
          for (const lead of results) {
            if (lead.name && lead.phone && !leads.has(lead.phone)) {
              // Limpeza do telefone e adição do DDI 55
              let cleanPhone = lead.phone.replace(/\D/g, '');
              if (cleanPhone.length > 0) {
                if (!cleanPhone.startsWith('55') && cleanPhone.length >= 10) {
                  cleanPhone = '55' + cleanPhone;
                }
                
                if (cleanPhone.length >= 10) {
                  const leadData = {
                    id: Math.random().toString(36).substring(7),
                    name: lead.name,
                    phone: cleanPhone,
                    address: lead.address,
                    category: lead.category,
                    rating: 0,
                    reviews: 0
                  };
                  leads.add(lead.phone);
                  console.log(`Lead encontrado: ${lead.name} (${cleanPhone})`);
                  controller.enqueue(encoder.encode(JSON.stringify({ lead: leadData }) + "\n"));
                }
              }
            }
          }

          // Tentar múltiplos seletores para a barra de scroll
          const sidePanel = await page.$('div[role="feed"], div[role="main"], #QA0Szd > div > div > div.w67uBf-vS79t-d069Yb-auo9S > div.e07Xqc-vS79t-adS7Wb.Z096Me-Xp096b-X3096b > div > div.m679Yc-vS79t-adS7Wb-m679Yc-vS79t-d069Yb-auo9S > div > div > div.m679Yc-vS79t-adS7Wb-m679Yc-vS79t-d069Yb-auo9S');
          
          if (sidePanel) {
            await sidePanel.evaluate(el => el.scrollBy(0, 1500));
            scrollCount++;
            // Delay aleatório de 2 a 5 segundos
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 2000));
            
            // Verificar se chegou ao fim (múltiplos seletores)
            const isEnd = await page.evaluate(() => {
              return document.body.innerText.includes("Você chegou ao final da lista") || 
                     document.body.innerText.includes("Não encontramos mais resultados");
            });
            if (isEnd) {
              console.log("Fim da lista alcançado.");
              break;
            }
          } else {
            console.log("Painel lateral não encontrado para scroll.");
            // Tentar um scroll genérico na página se falhar o painel específico
            await page.mouse.wheel(0, 1000);
            scrollCount++;
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        console.log("Varredura concluída.");
        if (browser) await browser.close();
        controller.close();
      } catch (error: any) {
        console.error("Erro no scraping:", error);
        if (!controller.desiredSize === null) { // Check if controller is still open
           controller.enqueue(encoder.encode(JSON.stringify({ error: "Erro interno durante a varredura: " + error.message }) + "\n"));
        }
        if (browser) await browser.close();
        try { controller.close(); } catch(e) {}
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    },
  });
}
