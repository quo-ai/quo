# Which AI model runs on my device?

Quo runs open AI models on your own device. You download a model once. After that it works with no internet, and what you type stays on your device. Quo looks at your device and suggests a model that runs well; this page lists every model in Quo and what each one needs.

Memory decides which models run well. A bigger model gives better answers but needs more memory, and a model that doesn’t fit runs slowly or not at all.

## On a computer: the desktop app

The desktop app runs models on your graphics card with llama.cpp, on Mac, Windows and Linux. It can also search Hugging Face and run almost any GGUF model. “Memory it needs” is the computer’s memory, or the graphics card’s own memory when the model runs there. The download includes the file for reading photos.

| Model | Good at | Download | Memory it needs | Reads photos | Thinks first | Code mode |
| --- | --- | --- | --- | --- | --- | --- |
| **[Qwen3.5 4B](https://quo.computer/models/qwen3.5-4b/)** | Strong all-rounder with careful reasoning. Reads images. Best on a computer with a graphics card. | 3.5 GB | 8 GB | Yes | Yes | Basic |
| **[Qwen3.5 9B](https://quo.computer/models/qwen3.5-9b/)** | A big step up in quality and reasoning. Reads images. Wants a graphics card with 8 GB or more, or 16 GB of memory. | 6.8 GB | 12 GB | Yes | Yes | Good |
| **[Qwen3.8 27B](https://quo.computer/models/qwen3.8-27b/)** | The most capable model here. Reads images. For computers with 32 GB or more of memory, or a high-end graphics card. | 17.4 GB | 32 GB | Yes | Yes | Good |
| **[Gemma 4 E2B](https://quo.computer/models/gemma-4-e2b/)** | Google’s small multilingual model. Reads images and speaks 140+ languages. | 3.6 GB | 8 GB | Yes | Yes | Basic |
| **[Gemma 4 12B](https://quo.computer/models/gemma-4-12b/)** | Google’s mid-size model: clear writing in 140+ languages. Reads images. Wants a graphics card with 8 GB or more, or 16 GB of memory. | 6.9 GB | 12 GB | Yes | Yes | Basic |
| **[Gemma 4 26B A4B](https://quo.computer/models/gemma-4-26b-a4b/)** | Google’s larger model, quick for its size: it uses only part of itself for each word. Reads images. For computers with 24 GB or more of memory. | 15.4 GB | 24 GB | Yes | Yes | Basic |
| **[Llama 3.2 3B](https://quo.computer/models/llama-3.2-3b/)** | Dependable all-rounder for writing and summarising. | 2 GB | 8 GB | No | No | Basic |
| **[Phi-4 Mini](https://quo.computer/models/phi-4-mini/)** | Microsoft’s compact reasoning model. Strong at maths, logic and structured answers. | 2.5 GB | 8 GB | No | No | Basic |

## In a browser: Quo Web

[Quo Web](https://app.quo.computer/) runs smaller models in Chrome or Edge, on the graphics card. Firefox and Safari run them on the processor, which is slower. Phone browsers don’t have the memory: use the app.

| Model | Good at | Download | Memory it needs | Thinks first |
| --- | --- | --- | --- | --- |
| **[Qwen3.5 0.8B](https://quo.computer/models/qwen3.5-0.8b/)** | Fast and light. A quick first download that runs on almost any computer. | 0.5 GB | 4 GB | Yes |
| **[Qwen3.5 2B](https://quo.computer/models/qwen3.5-2b/)** | Balanced. Noticeably smarter, still quick on most laptops. | 1.3 GB | 8 GB | Yes |
| **[Llama 3.2 3B](https://quo.computer/models/llama-3.2-3b/)** | Dependable all-rounder for writing and summarising. | 2 GB | 8 GB | No |
| **[Gemma 4 E2B](https://quo.computer/models/gemma-4-e2b/)** | Google’s small model, at home in 140+ languages. Best with a graphics card. | 2.6 GB | 8 GB | Yes |
| **[SmolLM3 3B](https://quo.computer/models/smollm3-3b/)** | Hugging Face’s compact model. Writes well in six European languages, and can think first. | 1.9 GB | 8 GB | Yes |
| **[Ministral 3B](https://quo.computer/models/ministral-3b/)** | Mistral’s small model. Precise, short answers in many languages. | 2.1 GB | 8 GB | No |
| **[Phi-4 Mini](https://quo.computer/models/phi-4-mini/)** | Microsoft’s compact reasoning model. Strong at maths, logic and structured answers. | 2.5 GB | 8 GB | No |

## On a phone: the Android app

The phone app checks your phone and offers the models that run well on it. Three are free; the others come with the one-time Premium upgrade. The iPhone app is coming soon.

| Model | Good at | Download | Reads photos | Thinks first | Free or Premium |
| --- | --- | --- | --- | --- | --- |
| **[Nanbeige4 Thinking (3B)](https://quo.computer/models/nanbeige4-thinking-3b/)** | Deep thinker in a small package. Great writing, reasoning, and analysis. | 2.4 GB | No | Yes | Premium |
| **[SmolLM3 (3B)](https://quo.computer/models/smollm3-3b/)** | Strong compact text model with broad European language support. Good for writing, coding, and analysis. | 1.9 GB | No | Yes | Premium |
| **[Ministral (3B)](https://quo.computer/models/ministral-3b/)** | Free vision model. Send a photo and ask anything about it. | 3 GB | Yes | No | Free |
| **[Ministral Reasoning (3B)](https://quo.computer/models/ministral-reasoning-3b/)** | Vision + deep reasoning and vast knowledge. Analyse images, documents, and complex problems. | 3.3 GB | Yes | Yes | Premium |
| **[Qwen3.5 (0.8B)](https://quo.computer/models/qwen3.5-0.8b/)** | Recommended starter model. Ultra-light, fast, and best for quick offline setup on most phones. | 0.5 GB | No | Yes | Free |
| **[Qwen3.5 (2B)](https://quo.computer/models/qwen3.5-2b/)** | Free balanced upgrade with stronger reasoning and coding while still staying compact. | 1.3 GB | No | Yes | Free |
| **[Qwen3.5 (4B)](https://quo.computer/models/qwen3.5-4b/)** | High-end multimodal model. See and discuss images, deep reasoning, and broad multilingual knowledge on newer devices. | 3.4 GB | Yes | Yes | Premium |
| **[Gemma 4 (E2B)](https://quo.computer/models/gemma-4-e2b/)** | Google's latest small model. Sees images, uses tools, and speaks 140+ languages. | 4.1 GB | Yes | Yes | Premium |
| **[Gemma 3 (4B)](https://quo.computer/models/gemma-3-4b/)** | Google multilingual all-rounder with vision. Strong quality across 140+ languages. | 3.3 GB | Yes | No | Premium |
| **[Gemma 3 (1B)](https://quo.computer/models/gemma-3-1b/)** | Tiny, fast Google model for quick answers on any device. | 0.8 GB | No | No | Premium |
| **[Phi-4 Mini (3.8B)](https://quo.computer/models/phi-4-mini/)** | Microsoft compact reasoning specialist. Excellent at math, logic, and structured answers. | 2.5 GB | No | No | Premium |
| **[Llama 3.2 (3B)](https://quo.computer/models/llama-3.2-3b/)** | Meta dependable generalist for balanced chat, writing, and summarisation. | 2 GB | No | No | Premium |

## Which one should I choose?

- **Start with the model Quo suggests.** It checks your device’s memory and graphics card first.
- **To ask about photos,** choose a model that reads photos.
- **Models that think first** work through a question step by step before they answer: slower, and better at maths and planning. You can read their thinking.
- **For Code mode** in the desktop app, choose a model rated Good for it, or a cloud model.

Every model on this page runs on your own device, free, with no account. See [pricing](https://quo.computer/pricing/) for the optional cloud models.

---
Every open AI model in Quo for phone, browser and desktop: download size, memory it needs, photos, thinking, free or Premium.
This page: https://quo.computer/models/
