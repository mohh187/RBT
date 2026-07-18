// AR 3D helpers.
//
// HONESTY OF SCOPE: true photo→3D-mesh generation needs an external 3D-gen
// service (none is wired). What we build automatically is an AR *standee*: the
// item's background-removed photo becomes a textured upright plane exported as
// a real GLB — placed on the customer's actual table via the platform AR viewer
// (<model-viewer>: Scene Viewer on Android / Quick Look on iOS). Venues can also
// upload a REAL .glb/.usdz model made elsewhere; the viewer treats both alike.
//
// three.js is heavy → everything here is loaded lazily by callers.

// Build a GLB blob from an image URL/Blob: an upright double-sided plane with
// the (ideally transparent) photo as its texture, ~26cm tall — table scale.
export async function makeStandeeGlb(imageSrc, { heightM = 0.26 } = {}) {
  const [{ Scene, PerspectiveCamera, TextureLoader, MeshBasicMaterial, PlaneGeometry, Mesh, DoubleSide, SRGBColorSpace }, { GLTFExporter }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
  ])

  const url = typeof imageSrc === 'string' ? imageSrc : URL.createObjectURL(imageSrc)
  try {
    const texture = await new Promise((res, rej) => new TextureLoader().load(url, res, undefined, () => rej(new Error('تعذر تحميل الصورة (قد يكون بسبب CORS — ارفع الصورة مباشرة أو فعّل إعداد CORS)'))))
    texture.colorSpace = SRGBColorSpace
    const img = texture.image
    const aspect = img && img.width ? img.width / img.height : 1

    const scene = new Scene()
    const geo = new PlaneGeometry(heightM * aspect, heightM)
    const mat = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.05, side: DoubleSide })
    const mesh = new Mesh(geo, mat)
    mesh.position.y = heightM / 2 // stand ON the floor/table plane, not through it
    scene.add(mesh)
    // model-viewer needs a camera-free scene; exporter handles the rest
    void PerspectiveCamera

    const glb = await new Promise((res, rej) => {
      new GLTFExporter().parse(scene, res, (e) => rej(new Error(String(e?.message || e))), { binary: true })
    })
    return new Blob([glb], { type: 'model/gltf-binary' })
  } finally {
    if (typeof imageSrc !== 'string') URL.revokeObjectURL(url)
  }
}

// Full pipeline: item photo → background removal → GLB standee blob.
export async function photoToArStandee(imageUrl, { onStep } = {}) {
  onStep?.('bg')
  const { removeBackgroundToFile } = await import('./bgRemove.js')
  let cutout
  try {
    cutout = await removeBackgroundToFile(imageUrl, 'ar-cutout.png')
  } catch (_) {
    // bg removal failed (huge image / CORS) — still make a standee from the raw photo
    cutout = imageUrl
  }
  onStep?.('glb')
  return makeStandeeGlb(cutout)
}

// One-time loader for the <model-viewer> custom element (registers globally).
let mvLoaded = null
export function loadModelViewer() {
  if (!mvLoaded) mvLoaded = import('@google/model-viewer')
  return mvLoaded
}
