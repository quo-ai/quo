import { useState } from 'react';
import { Download, ImageOff } from 'lucide-react';
import type { GeneratedImage } from '../../chat/types';
import { Facts } from '../Facts';
import { ImageViewer } from '../ImageViewer';

const ratio = (aspect: string) => aspect.replace(':', ' / ');
/** What an image cost, as replies show it: free, or the credits with up to two decimals. */
const cost = (charged: number | undefined) => (charged === undefined ? null : charged === 0 ? 'Free' : `${charged} credit${charged === 1 ? '' : 's'}`);
const extension = (dataUrl: string) => /^data:image\/(png|jpeg|webp)/.exec(dataUrl)?.[1]?.replace('jpeg', 'jpg') ?? 'png';

/**
 * The images a reply asked for (src/images/), under its words: a placeholder while one is made, then the image with the
 * prompt it was made from, the image model, and a way to save it. Made on this computer (offline chats with an image
 * model downloaded) or in Quo's cloud from the prompt alone.
 */
export function GeneratedImages({ images }: { images: GeneratedImage[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const shown = viewing === null ? null : images[viewing];
  return (
    <div className="gen-images">
      {shown?.dataUrl && <ImageViewer src={shown.dataUrl} alt={shown.prompt} caption={shown.prompt} fileName={`quo-image-${(viewing ?? 0) + 1}.${extension(shown.dataUrl)}`} onClose={() => setViewing(null)} />}
      {images.map((image, index) => (
        <figure key={image.id} className={`gen-image ${image.status}`}>
          {image.status === 'done' && image.dataUrl ? (
            <button type="button" className="image-open" onClick={() => setViewing(index)} title="See it full size" aria-label={`See full size: ${image.prompt}`}>
              <img src={image.dataUrl} alt={image.prompt} style={{ aspectRatio: ratio(image.aspect) }} />
            </button>
          ) : (
            <div className="gen-frame" style={{ aspectRatio: ratio(image.aspect) }} role={image.status === 'creating' ? 'status' : undefined}>
              {image.status === 'creating' ? <><span className="bar" /> {image.edit ? 'Changing the image…' : 'Creating an image…'}{image.progress ? ` Step ${image.progress.step} of ${image.progress.steps}` : ''}</> : <><ImageOff size={18} /> {image.error ?? 'The image couldn’t be made.'}</>}
            </div>
          )}
          <figcaption>
            <details>
              <summary>{image.status === 'done' && image.model ? <Facts items={[`Made with ${image.model}`, image.where === 'device' ? 'On this computer' : cost(image.charged)]} /> : 'Image prompt'}</summary>
              <p>{image.prompt}</p>
            </details>
            {image.status === 'done' && image.dataUrl && (
              <a className="icon-btn press" href={image.dataUrl} download={`quo-image-${index + 1}.${extension(image.dataUrl)}`} aria-label="Save image" title="Save image">
                <Download size={15} />
              </a>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
