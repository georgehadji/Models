// Synthetic catalog in the OpenRouter wire format, for tests only.
// Vendors and numbers are made up; they do not describe real models.

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const AUTHORS = ['acme', 'globex', 'initech', 'umbrella', 'hooli', 'stark'];
const EFFORTS = ['xhigh', 'high', 'medium', 'low', 'minimal'];

export function makeCatalog({ count = 48, now = Date.UTC(2026, 9, 1) } = {}) {
  const r = rng(42);
  const data = [];
  for (let i = 0; i < count; i++) {
    const author = AUTHORS[i % AUTHORS.length];
    const free = i % 11 === 0;
    const reasoning = i % 3 !== 0;
    const imageOut = i % 13 === 5;
    const inPrice = free ? 0 : Number((0.02 + r() ** 2 * 15).toFixed(2)) / 1e6;
    const params = ['temperature', 'max_tokens', 'top_p'];
    if (i % 2 === 0) params.push('tools', 'tool_choice');
    if (i % 4 === 0) params.push('structured_outputs', 'response_format');
    if (reasoning) params.push('reasoning', 'include_reasoning');
    if (i % 5 === 0) params.push('web_search_options');
    if (i % 6 === 0) params.push('logprobs', 'seed');
    data.push({
      id: `${author}/model-${String.fromCharCode(97 + (i % 26))}${i}${free ? ':free' : ''}`,
      canonical_slug: `${author}/model-${i}`,
      name: `${author[0].toUpperCase()}${author.slice(1)} Model ${i}${free ? ' (free)' : ''}`,
      created: Math.floor((now - Math.floor(r() * 700) * 86400000) / 1000),
      description: 'Synthetic test model.',
      context_length: [8192, 32768, 131072, 200000, 1048576, 2000000][i % 6],
      architecture: {
        modality: imageOut ? 'text+image->text+image' : 'text->text',
        input_modalities: i % 2 ? ['text', 'image'] : i % 7 === 0 ? ['text', 'file', 'audio'] : ['text'],
        output_modalities: imageOut ? ['text', 'image'] : ['text'],
        tokenizer: 'Other',
        instruct_type: null,
      },
      pricing: {
        prompt: String(inPrice),
        completion: String(inPrice * 4),
        ...(i % 4 === 1 ? { input_cache_read: String(inPrice / 10) } : {}),
        ...(reasoning && i % 5 === 1 ? { internal_reasoning: String(inPrice * 4) } : {}),
        ...(imageOut ? { image_output: String((0.01 + r() * 0.1).toFixed(3)) } : {}),
      },
      top_provider: { context_length: null, max_completion_tokens: [4096, 16384, 65536, null][i % 4], is_moderated: i % 9 === 0 },
      per_request_limits: null,
      supported_parameters: params,
      default_parameters: null,
      supported_voices: null,
      links: { details: `/api/v1/models/${author}/model-${i}/endpoints` },
      ...(reasoning
        ? {
            reasoning: {
              mandatory: i % 4 === 2,
              supported_efforts: i % 5 === 0 ? null : EFFORTS.slice(i % 3),
              default_effort: 'medium',
              ...(i % 2 === 0 ? { supports_max_tokens: true } : {}),
            },
          }
        : {}),
      ...(i % 3 === 1
        ? {
            benchmarks: {
              artificial_analysis: {
                intelligence_index: Math.round(20 + r() * 50),
                coding_index: Math.round(15 + r() * 50),
                agentic_index: i % 2 ? Math.round(10 + r() * 50) : null,
              },
              design_arena: [],
            },
          }
        : {}),
    });
  }
  // A router with dynamic pricing (negative sentinel), which must not be charted as a price.
  data.push({
    id: 'acme/auto-router',
    canonical_slug: 'acme/auto-router',
    name: 'Acme Auto Router',
    created: Math.floor(now / 1000) - 86400,
    context_length: 2000000,
    architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '-1', completion: '-1' },
    top_provider: { is_moderated: false },
    per_request_limits: null,
    supported_parameters: ['tools'],
    default_parameters: null,
    supported_voices: null,
    links: { details: '' },
  });

  const images = {
    data: data
      .filter((m) => m.architecture.output_modalities.includes('image'))
      .map((m, i) => ({
        id: m.id,
        name: m.name,
        created: m.created,
        description: '',
        endpoints: `/api/v1/images/models/${m.id}/endpoints`,
        architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
        supported_parameters: Object.fromEntries(
          ['size', 'quality', 'n', 'seed', 'background', 'style'].slice(0, 3 + (i % 4)).map((k) => [k, { type: 'boolean' }]),
        ),
        supports_streaming: i % 2 === 0,
      })),
  };

  const videos = {
    data: ['acme/vid-1', 'globex/vid-2', 'hooli/vid-3', 'stark/vid-upscale'].map((id, i) => ({
      id,
      canonical_slug: id,
      name: `${id.split('/')[0]} Video ${i + 1}`,
      created: Math.floor(now / 1000) - i * 86400 * 30,
      allowed_passthrough_parameters: [],
      creativity: null,
      generate_audio: i % 2 === 0,
      seed: i !== 1,
      supported_aspect_ratios: ['16:9', '9:16'],
      supported_durations: [[4, 8], [5, 10], [4, 6, 8, 12], []][i],
      supported_frame_images: [['first_frame'], ['first_frame', 'last_frame'], [], []][i],
      supported_resolutions: [['720p', '1080p'], ['480p', '720p'], ['720p', '1080p', '4K'], ['1080p']][i],
      supported_sizes: null,
      upscale_factor: null,
      pricing_skus: [{ per_second_720p: '0.10', per_second_1080p: '0.25' }, { per_second: '0.05' }, { per_video: '1.20' }, null][i],
    })),
  };

  return { models: { data }, images, videos };
}
