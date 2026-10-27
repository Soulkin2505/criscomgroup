"use client"

// 1 - Hero carrusel de banners (GET /api/ecommerce/banners).
// Titular = titulo del banner (sin prefijos internos seed-*), WhatsApp propio por banner
// (null => el global de config-publica; ambos vacios => sin boton). Flechas/puntos de 44px,
// teclado (flechas) y gesto tactil. Video con boton Pausar y respeto a prefers-reduced-motion.
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, ChevronLeft, ChevronRight, Cpu, MessageCircle, Pause, Play, RefreshCw, AlertTriangle } from "lucide-react"
import { homeService, type HomeBanner, type HomeStats } from "@/services/homeService"
import { cleanTitulo, waHref } from "@/components/home/homeShared"
import { useConfigPublica } from "@/hooks/useSocialLinks"

type Status = "loading" | "error" | "ready"

const HeroCarousel = () => {
  const [status, setStatus] = useState<Status>("loading")
  const [banners, setBanners] = useState<HomeBanner[]>([])
  const [stats, setStats] = useState<HomeStats | null>(null)
  const [slide, setSlide] = useState(0)
  const [videoPlaying, setVideoPlaying] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)
  const touchX = useRef<number | null>(null)
  const config = useConfigPublica()

  const load = useCallback(() => {
    setStatus("loading")
    Promise.all([
      homeService.banners(),
      homeService.estadisticas().catch(() => null),
    ])
      .then(([bs, st]) => {
        const activos = (Array.isArray(bs) ? bs : [])
          .filter((b) => b.activo !== false && Boolean(b.imagen_url))
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        setBanners(activos)
        setStats(st)
        setSlide(0)
        setStatus("ready")
      })
      .catch(() => setStatus("error"))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    }
  }, [])

  const total = banners.length
  const go = useCallback((next: number) => {
    setSlide(total ? (next + total) % total : 0)
  }, [total])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (total < 2) return
    if (e.key === "ArrowLeft") go(slide - 1)
    if (e.key === "ArrowRight") go(slide + 1)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    touchX.current = target.closest("button,a") ? null : e.clientX
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (touchX.current == null) return
    const dx = e.clientX - touchX.current
    touchX.current = null
    if (Math.abs(dx) > 40 && total > 1) go(slide + (dx < 0 ? 1 : -1))
  }

  if (status === "loading") {
    return (
      <section className="sec-first pg-wrap" aria-label="Banners destacados" aria-busy="true">
        <div className="skel tall" style={{ width: "100%" }} />
      </section>
    )
  }

  if (status === "error") {
    return (
      <section className="sec-first pg-wrap" aria-label="Banners destacados">
        <div className="box err" role="alert">
          <span className="tile"><AlertTriangle className="pg-ic" aria-hidden /></span>
          <div className="grow">
            <h3>No pudimos cargar los banners</h3>
            <p>El resto de la página sigue disponible. Revisa tu conexión e inténtalo de nuevo.</p>
          </div>
          <button type="button" className="btn btn-outline" onClick={load}>
            <RefreshCw className="pg-ic" aria-hidden /> Reintentar
          </button>
        </div>
      </section>
    )
  }

  if (total === 0) {
    return (
      <section className="sec-first pg-wrap" aria-label="Tecnología Criscom Group">
        <div className="hero hero-welcome">
          <div className="hero-txt">
            <div>
              <p className="hero-eyebrow"><Cpu className="pg-ic" aria-hidden /> CRISCOM GROUP</p>
              <h1>Tu próxima idea.<br /><span>Tu próximo equipo.</span></h1>
              <p className="hero-description">Tecnología para jugar, crear y trabajar. Encuentra tu equipo o arma una PC a tu medida con nosotros.</p>
            </div>
            <div className="hero-ctas">
              <Link className="btn btn-light" href="/catalogo">Explorar catálogo <ArrowRight size={18} aria-hidden /></Link>
              <Link className="btn btn-hero-secondary" href="/armar-pc">Armar mi PC <ArrowRight size={18} aria-hidden /></Link>
            </div>
            <p className="hero-caption">Equipos · Componentes · Servicio técnico</p>
          </div>
          <div className="hero-media welcome-media" role="img" aria-label="Computadora, laptop y componentes tecnológicos" />
        </div>
      </section>
    )
  }

  const banner = banners[Math.min(slide, total - 1)]
  const titulo = cleanTitulo(banner.titulo) || "Criscom Group"
  const waNumero = banner.whatsapp || config?.whatsapp_number || ""
  const waUrl = waHref(waNumero)
  const esVideo = banner.media_type === "video"

  const toggleVideo = (e: React.MouseEvent<HTMLButtonElement>) => {
    const video = e.currentTarget.closest(".hero-media")?.querySelector("video")
    if (!video) return
    if (video.paused) { video.play(); setVideoPlaying(true) } else { video.pause(); setVideoPlaying(false) }
  }

  return (
    <section className="sec-first pg-wrap" aria-roledescription="carrusel" aria-label="Banners destacados">
      <div
        className="hero"
        role="group"
        aria-roledescription="diapositiva"
        aria-label={`${slide + 1} de ${total}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div className="hero-txt">
          <div>
            <h1>{titulo}</h1>
            {stats && (
              <p className="hero-stats num">
                {stats.productos_disponibles} productos disponibles · {stats.clientes_atendidos} clientes atendidos
              </p>
            )}
          </div>
          <div className="hero-ctas">
            <Link className="btn btn-light" href="/catalogo">
              Explorar catálogo <ArrowRight style={{ width: 16, height: 16 }} aria-hidden />
            </Link>
            {waUrl && (
              <a className="btn btn-wa" href={waUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="pg-ic" aria-hidden /> Escribir por WhatsApp
              </a>
            )}
          </div>
          {total > 1 && (
            <div className="hero-ctl">
              <button type="button" className="ar" aria-label="Banner anterior" onClick={() => go(slide - 1)}>
                <ChevronLeft className="pg-ic" aria-hidden />
              </button>
              {banners.map((b, i) => (
                <button
                  key={b.id_banner}
                  type="button"
                  className="dot"
                  aria-label={`Ir al banner ${i + 1}`}
                  aria-current={i === slide}
                  onClick={() => go(i)}
                />
              ))}
              <button type="button" className="ar" aria-label="Banner siguiente" onClick={() => go(slide + 1)}>
                <ChevronRight className="pg-ic" aria-hidden />
              </button>
              <span className="cnt num" aria-live="polite">{slide + 1} / {total}</span>
            </div>
          )}
        </div>

        {esVideo ? (
          <div className="hero-media">
            <video
              src={banner.imagen_url}
              muted
              loop
              playsInline
              autoPlay={!reducedMotion}
              preload="metadata"
              aria-label={`Video del banner: ${titulo}`}
            />
            <button type="button" className="vctl" onClick={toggleVideo}>
              {videoPlaying && !reducedMotion
                ? <><Pause style={{ width: 16, height: 16 }} aria-hidden /><span>Pausar video</span></>
                : <><Play style={{ width: 16, height: 16 }} aria-hidden /><span>Reproducir video</span></>}
            </button>
          </div>
        ) : (
          <div
            className="hero-media"
            role="img"
            aria-label={`Imagen del banner: ${titulo}`}
            style={{ backgroundImage: `url("${banner.imagen_url}")` }}
          />
        )}
      </div>
    </section>
  )
}

export default HeroCarousel
