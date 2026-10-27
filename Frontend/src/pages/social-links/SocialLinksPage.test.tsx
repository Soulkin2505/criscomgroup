import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import SocialLinksPage from './SocialLinksPage'
import { getSocialLinks, updateSocialLinks } from '../../services/socialLinksService'

vi.mock('../../services/socialLinksService', () => ({
  getSocialLinks: vi.fn(),
  updateSocialLinks: vi.fn(),
}))
vi.mock('../../services/marketingService', async () => ({
  ...(await vi.importActual<object>('../../services/marketingService')),
  getBanners: vi.fn().mockResolvedValue([]),
}))
// RUC publico (EmpresaPublicaCard) se prueba aparte; aqui solo evita que dispare una llamada real.
vi.mock('../../services/companyService', () => ({
  fetchCompanies: vi.fn().mockResolvedValue([]),
  setCompanyMostrarEnWeb: vi.fn(),
}))

const empty = { instagram_url: '', facebook_url: '', tiktok_url: '', youtube_url: '', whatsapp_number: '' }
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SocialLinksPage /></QueryClientProvider>)

describe('Redes y banners', () => {
  it('permite escribir y guardar sin controles bloqueados', async () => {
    vi.mocked(getSocialLinks).mockResolvedValue(empty)
    vi.mocked(updateSocialLinks).mockImplementation(async value => value)
    renderPage()

    const instagram = await screen.findByLabelText('Instagram')
    expect(instagram).not.toBeDisabled()
    expect(instagram).not.toHaveAttribute('readonly')
    await userEvent.type(instagram, 'https://www.instagram.com/prueba/')
    await userEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(updateSocialLinks).toHaveBeenCalledWith(expect.objectContaining({ instagram_url: 'https://www.instagram.com/prueba/' })))
  })

  it('avisa del enlace inválido y no guarda', async () => {
    vi.mocked(getSocialLinks).mockResolvedValue(empty)
    vi.mocked(updateSocialLinks).mockClear()
    renderPage()
    await userEvent.type(await screen.findByLabelText('Instagram'), 'http://instagram.com/x')
    expect(await screen.findByText('Instagram debe ser un enlace https de instagram.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    expect(updateSocialLinks).not.toHaveBeenCalled()
  })

  it('si falla la carga ofrece Reintentar y no deja guardar', async () => {
    vi.mocked(getSocialLinks).mockRejectedValueOnce({ response: { data: { message: 'Sin conexión' } } })
    renderPage()
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toHaveAttribute('aria-disabled', 'true')
  })
})
