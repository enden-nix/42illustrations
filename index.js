export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let targetUrl = url.searchParams.get('url');

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'URLが指定されていません' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const urlMatch = targetUrl.match(/https?:\/\/[^ \n\r\t\]\)]+/);
    if (!urlMatch) {
      return new Response(JSON.stringify({ error: '有効なURLではありません', input: targetUrl }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    targetUrl = urlMatch[0];

    try {
      const parsedTarget = new URL(targetUrl);
      let imageUrl = '';

      // ======== 1. X (Twitter) の場合 ========
      if (parsedTarget.hostname.includes('x.com') || parsedTarget.hostname.includes('twitter.com') || parsedTarget.hostname.includes('fxtwitter.com')) {
        parsedTarget.hostname = 'api.fxtwitter.com';
        const apiUrl = parsedTarget.href;

        const apiRes = await fetch(apiUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        if (apiRes.ok) {
          const apiJson = await apiRes.json();
          if (apiJson.code === 200 && apiJson.tweet?.media?.photos) {
            imageUrl = apiJson.tweet.media.photos[0].url;
          }
        }
      } 
      // ======== 2. Bluesky (bsky.app) の場合 (DiscordBotとしてOGP取得) ========
      else if (parsedTarget.hostname.includes('bsky.app')) {
        const res = await fetch(targetUrl, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' 
          }
        });

        if (res.ok) {
          const html = await res.text();
          // og:image または twitter:image から画像URLを抽出
          const ogMatch = html.match(/<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content="([^"]+)"/i) ||
                          html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="(?:og:image|twitter:image)"/i);
          if (ogMatch && ogMatch[1]) {
            imageUrl = ogMatch[1].replace(/&amp;/g, '&');
          }
        }
      }
      // ======== 3. Pixiv の場合 (Phixiv活用) ========
      else if (parsedTarget.hostname.includes('pixiv.net')) {
         const pixivIdMatch = parsedTarget.pathname.match(/artworks\/(\d+)/);
         if (pixivIdMatch) {
           const pixivId = pixivIdMatch[1];
           const phixivUrl = `https://www.phixiv.net/artworks/${pixivId}`;
           const phRes = await fetch(phixivUrl, {
             headers: { 
               'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' 
             }
           });
           
           if (phRes.ok) {
             const html = await phRes.text();
             const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
             if (ogMatch && ogMatch[1]) {
               imageUrl = ogMatch[1].replace(/&amp;/g, '&');
             }
           }
         }
      }

      if (!imageUrl) {
        return new Response(JSON.stringify({ error: '画像URLの抽出に失敗しました', targetUrl }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ======== 4. 抽出した画像実体を取得して配信 ========
      const imageRes = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': parsedTarget.hostname.includes('pixiv') ? 'https://www.pixiv.net/' : ''
        }
      });

      if (!imageRes.ok) {
        return new Response(JSON.stringify({ error: '画像本体の取得に失敗', status: imageRes.status, imageUrl }), {
          status: imageRes.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 画像バイナリと適切なContentTypeを返却
      const response = new Response(imageRes.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': imageRes.headers.get('Content-Type') || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
        }
      });
      return response;

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
};