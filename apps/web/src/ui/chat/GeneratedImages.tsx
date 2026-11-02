import { Download, ImageOff } from 'lucide-react';
import type { GeneratedImage } from '../../chat/types';

const ratio = (aspect: string) => aspect.replace(':', ' / ');
const extension = (dataUrl: string) => /^data:image\/(png|jpeg|webp)/.exec(dataUrl)?.[1]?.replace('jpeg', 'jpg') ?? 'png';

/**
 * The images a reply asked for (src/images/), under its words: a placeholder while one is made, then the image with the
 * prompt it was made from, the image model, and a way to save it. Made in Quo's cloud from the prompt alone.
 */
export function GeneratedImages({ images }: { images: GeneratedImage[] }) {
  return (
    <div className="gen-images">
      {images.map((image, index) => (
        <figure key={image.id} className={`gen-image ${image.status}`}>
          {image.status === 'done' && image.dataUrl ? (
            <img src={image.dataUrl} alt={image.prompt} style={{ aspectRatio: ratio(image.aspect) }} />
          ) : (
            <div className="gen-frame" style={{ aspectRatio: ratio(image.aspect) }} role={image.status === 'creating' ? 'status' : undefined}>
              {image.status === 'creating' ? <><span className="bar" /> {image.edit ? 'Changing the image…' : 'Creating an image…'}</> : <><ImageOff size={18} /> {image.error ?? 'The image couldn’t be made.'}</>}
            </div>
          )}
          <figcaption>
            <details>
              <summary>{image.status === 'done' && image.model ? `Made with ${image.model}` : 'Image prompt'}</summary>
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
