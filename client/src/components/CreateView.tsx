import React, { useState } from 'react';
import { Camera, Image as ImageIcon, MapPin, Tag, Users } from 'lucide-react';
import { api, resolveMediaUrl } from '../api';
import { filterStyleToCss } from '../utils';

interface CreateViewProps {
  onCreatedPost: () => void;
  onCreatedStory: () => void;
  onNotify: (msg: string) => void;
}

export const CreateView: React.FC<CreateViewProps> = ({
  onCreatedPost,
  onCreatedStory,
  onNotify,
}) => {
  const [mode, setMode] = useState<'post' | 'story'>('post');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Post fields
  const [caption, setCaption] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [filterStyle, setFilterStyle] = useState<'mono' | 'noir' | 'silver' | 'raw'>('mono');
  const [tagsInput, setTagsInput] = useState('');
  const [peopleInput, setPeopleInput] = useState('');

  // Story fields
  const [storyText, setStoryText] = useState('');
  const [storyBg, setStoryBg] = useState<'noir' | 'paper' | 'slate'>('noir');

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadImage(file);
      setImageUrl(res.url);
      onNotify('Photo uploaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    try {
      if (mode === 'post') {
        if (!imageUrl) {
          onNotify('Please select a photo first.');
          setSubmitting(false);
          return;
        }
        const tags = tagsInput
          .split(/[,\s]+/)
          .map((t) => t.replace(/^#/, '').trim().toLowerCase())
          .filter(Boolean);
        const taggedUsers = peopleInput
          .split(/[,\s]+/)
          .map((u) => u.replace(/^@/, '').trim().toLowerCase())
          .filter(Boolean)
          .map((username, idx) => ({
            username,
            posX: 30 + ((idx * 22) % 45),
            posY: 38 + ((idx * 17) % 35),
          }));

        await api.createPost({
          imageUrl,
          caption,
          locationName,
          locationCity,
          filterStyle,
          tags,
          taggedUsers,
        });
        setImageUrl('');
        setCaption('');
        setLocationName('');
        setLocationCity('');
        setTagsInput('');
        setPeopleInput('');
        onNotify('Photo shared to feed.');
        onCreatedPost();
      } else {
        if (!imageUrl && !storyText.trim()) {
          onNotify('Add a photo or text for your 24h story.');
          setSubmitting(false);
          return;
        }
        const taggedUsernames = peopleInput
          .split(/[,\s]+/)
          .map((u) => u.replace(/^@/, '').trim().toLowerCase())
          .filter(Boolean);

        await api.createStory({
          mediaUrl: imageUrl,
          textContent: storyText,
          bgStyle: storyBg,
          locationName,
          taggedUsernames,
        });
        setImageUrl('');
        setStoryText('');
        setLocationName('');
        setPeopleInput('');
        onNotify('24-hour story published.');
        onCreatedStory();
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not publish.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`segmented-btn ${mode === 'post' ? 'active' : ''}`}
          onClick={() => setMode('post')}
        >
          Photo Post
        </button>
        <button
          type="button"
          className={`segmented-btn ${mode === 'story' ? 'active' : ''}`}
          onClick={() => setMode('story')}
        >
          24h Story
        </button>
      </div>

      <div className="info-banner" style={{ margin: '0 0 16px' }}>
        <Camera size={15} strokeWidth={1.6} />
        <span>Still photos & minimal stories only. MONO has no Reels.</span>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Photo picker + monochrome preview */}
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            aspectRatio: mode === 'post' ? '1 / 1' : '4 / 3',
            borderRadius: 16,
            border: '1px dashed var(--border-strong)',
            background: 'var(--bg-subtle)',
            overflow: 'hidden',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {imageUrl ? (
            <img
              src={resolveMediaUrl(imageUrl)}
              alt="Preview"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: filterStyleToCss(mode === 'post' ? filterStyle : 'mono'),
              }}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <ImageIcon size={28} strokeWidth={1.4} />
              <div style={{ fontWeight: 600, marginTop: 8 }}>
                {uploading ? 'Uploading photo…' : 'Tap to choose photo'}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                JPEG, PNG, WebP or GIF · Max 5 MB
              </div>
            </div>
          )}
        </label>

        {mode === 'post' ? (
          <>
            <div>
              <label className="field-label">Monochrome Grade</label>
              <div className="segmented">
                {(['mono', 'noir', 'silver', 'raw'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`segmented-btn ${filterStyle === f ? 'active' : ''}`}
                    onClick={() => setFilterStyle(f)}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="field-label">Caption</label>
              <textarea
                className="hig-textarea"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write something quiet and honest… #minimal"
                maxLength={1000}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="field-label">
                  <MapPin size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Location
                </label>
                <input
                  className="hig-input"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="Shibuya Crossing"
                />
              </div>
              <div>
                <label className="field-label">City</label>
                <input
                  className="hig-input"
                  value={locationCity}
                  onChange={(e) => setLocationCity(e.target.value)}
                  placeholder="Tokyo"
                />
              </div>
            </div>

            <div>
              <label className="field-label">
                <Tag size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Hashtags
              </label>
              <input
                className="hig-input"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="minimal, architecture, bw"
              />
            </div>

            <div>
              <label className="field-label">
                <Users size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Tag People (@usernames)
              </label>
              <input
                className="hig-input"
                value={peopleInput}
                onChange={(e) => setPeopleInput(e.target.value)}
                placeholder="maya, liam"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="field-label">Story Text (optional if photo attached)</label>
              <textarea
                className="hig-textarea"
                value={storyText}
                onChange={(e) => setStoryText(e.target.value)}
                placeholder="Share a 24-hour monochrome thought…"
                maxLength={240}
              />
            </div>

            <div>
              <label className="field-label">Surface Tone</label>
              <div className="segmented">
                {(['noir', 'paper', 'slate'] as const).map((bg) => (
                  <button
                    key={bg}
                    type="button"
                    className={`segmented-btn ${storyBg === bg ? 'active' : ''}`}
                    onClick={() => setStoryBg(bg)}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {bg}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="field-label">Location</label>
                <input
                  className="hig-input"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="Cupertino, CA"
                />
              </div>
              <div>
                <label className="field-label">Tag People</label>
                <input
                  className="hig-input"
                  value={peopleInput}
                  onChange={(e) => setPeopleInput(e.target.value)}
                  placeholder="maya, zara"
                />
              </div>
            </div>
          </>
        )}

        <button type="submit" className="btn-primary" disabled={uploading || submitting}>
          {submitting
            ? 'Publishing…'
            : mode === 'post'
              ? 'Share Photo'
              : 'Publish 24h Story'}
        </button>
      </form>
    </div>
  );
};
