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
      return new Response('URLが指定されていません', { status: 400, headers: corsHeaders });
    }

    const urlMatch = targetUrl.match(/https?:\/\/[^ \n\r\t\]\)]+/);
    if (!urlMatch) {
      return new Response(`有効なURLが見つかりません。\n入力値: ${targetUrl}`, { status: 400, headers: corsHeaders });
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

        if (!apiRes.ok) return new Response(`[エラー1] FixUpX APIが拒否: ${apiRes.status}`, { status: apiRes.status, headers: corsHeaders });

        const apiJson = await apiRes.json();
        if (apiJson.code === 200 && apiJson.tweet?.media?.photos) {
          imageUrl = apiJson.tweet.media.photos[0].url;
        } else {
          return new Response(`[エラー2] 画像が見つかりません。`, { status: 404, headers: corsHeaders });
        }
      } 
      // ======== 2. Bluesky (bsky.app) の場合 ========
      else if (parsedTarget.hostname.includes('bsky.app')) {
        // bsky.app のURLを fxbsky.app (または api.fxbsky.app) の構造に合わせて変換、あるいは oEmbed / Phixiv などの仕組みを活用
        // FxBlueskyのAPI形式に準拠してAPIを叩く
        const apiDomain = 'api.fxbsky.app';
        // bsky.app/profile/{handle}/post/{rkey} のパスをそのまま保持してAPIに投げる
        const apiUrl = `https://${apiDomain}${parsedTarget.pathname}`;

        const apiRes = await fetch(apiUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Discordbot/2.0' }
        });

        if (!apiRes.ok) {
          return new Response(`[エラー3] FxBluesky APIが拒否: ${apiRes.status}`, { status: apiRes.status, headers: corsHeaders });
        }

        const apiJson = await apiRes.json();
        // レスポンスから画像メディアのURLを抽出 (Fxtwitter互換スキーマまたはBlueskyのembed構造に対応)
        if (apiJson.code === 200 && apiJson.status?.media?.photos) {
          imageUrl = apiJson.status.media.photos[0].url;
        } else if (apiJson.post?.embed?.images) {
          imageUrl = apiJson.post.embed.images[0].fullsize || apiJson.post.embed.images[0].thumb;
        } else if (apiJson.embed?.images) {
          imageUrl = apiJson.embed.images[0].fullsize || apiJson.embed.images[0].thumb;
        } else {
          // フォールバックとして、oEmbed経由やHTMLメタタグ解析を試みる
          const oembedUrl = `https://embed.bsky.app/oembed?url=${encodeURIComponent(targetUrl)}`;
          const oRes = await fetch(oembedUrl);
          if (oRes.ok) {
            const oJson = await oRes.json();
            // 必要に応じてHTMLパース等にフォールバック
          }
        }

        if (!imageUrl) {
          // 万が一JSONから直接取れない場合、fxbskyのHTMLプレビューメタタグをスクレイピング
          parsedTarget.hostname = 'fxbsky.app';
          const htmlRes = await fetch(parsedTarget.href, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' }
          });
          if (htmlRes.ok) {
            const html = await htmlRes.text();
            const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
            if (ogImageMatch && ogImageMatch[1]) {
              imageUrl = ogImageMatch[1].replace(/&amp;/g, '&');
            }
          }
        }
      }
      // ======== 3. Pixiv の場合 ========
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
           
           if (!phRes.ok) {
             return new Response(`[エラー4] Phixivへのアクセス失敗: ${phRes.status}`, { status: phRes.status, headers: corsHeaders });
           }
           
           const html = await phRes.text();
           const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
           
           if (ogImageMatch && ogImageMatch[1]) {
             imageUrl = ogImageMatch[1];
             imageUrl = imageUrl.replace(/&amp;/g, '&');
           } else {
             return new Response(`[エラー5] Phixivのページからog:imageが見つかりませんでした。`, { status: 404, headers: corsHeaders });
           }
         }
      }

      if (!imageUrl) {
        return new Response(`[エラー6] 対象のURLから画像を抽出できませんでした。`, { status: 404, headers: corsHeaders });
      }

      // ======== 4. 抽出した画像URLをダウンロード ========
      const imageRes = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': targetUrl.includes('pixiv') ? 'https://www.pixiv.net/' : (targetUrl.includes('bsky.app') ? 'https://bsky.app/' : '')
        }
      });

      if (!imageRes.ok) {
         return new Response(`[エラー7] 画像本体のダウンロードに失敗: ${imageRes.status}\n対象URL: ${imageUrl}`, { status: imageRes.status, headers: corsHeaders });
      }

      const response = new Response(imageRes.body, imageRes);
      response.headers.set('Access-Control-Allow-Origin', '*');
      return response;

    } catch (error) {
      return new Response(`[重大なエラー] ${error.message}`, { status: 500, headers: corsHeaders });
    }
  }
};