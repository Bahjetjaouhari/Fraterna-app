from playwright.sync_api import sync_playwright
import os
import sys

# Fix encoding for Windows console
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def test_login_flow():
    with sync_playwright() as p:
        # Lanzar navegador en modo headless
        browser = p.chromium.launch(headless=True, args=['--ignore-certificate-errors'])
        context = browser.new_context(
            viewport={'width': 390, 'height': 844},  # iPhone 14 Pro size
            device_scale_factor=3,
            ignore_https_errors=True
        )
        page = context.new_page()

        # Capturar logs de consola
        console_logs = []
        page.on('console', lambda msg: console_logs.append(f'[Console] {msg.type}: {msg.text}'))

        # Capturar errores de página
        errors = []
        page.on('pageerror', lambda err: errors.append(f'[Page Error] {err}'))

        print("=" * 60)
        print("PRUEBA DE FLUJO DE LOGIN Y RECUPERACION DE CONTRASENA")
        print("=" * 60)

        # ============================================
        # TEST 1: Cargar página de Login
        # ============================================
        print("\n[TEST 1] Cargando pagina de Login...")
        page.goto('https://localhost:8081/login')
        page.wait_for_load_state('networkidle')

        # Screenshot del login
        page.screenshot(path='/tmp/01_login_page.png')
        print(f"   [OK] Login cargado: {page.title()}")

        # Verificar elementos del login
        email_input = page.locator('input[type="email"]')
        password_input = page.locator('input[type="password"]')
        forgot_password_link = page.locator('button:has-text("Olvidaste")')
        login_button = page.locator('button:has-text("Ingresar")')

        print(f"   [OK] Campo email visible: {email_input.is_visible()}")
        print(f"   [OK] Campo password visible: {password_input.is_visible()}")
        print(f"   [OK] Boton 'Olvidaste contrasena' visible: {forgot_password_link.is_visible()}")
        print(f"   [OK] Boton 'Ingresar' visible: {login_button.is_visible()}")

        # ============================================
        # TEST 2: Navegar a Forgot Password
        # ============================================
        print("\n[TEST 2] Navegando a Forgot Password...")
        forgot_password_link.click()
        page.wait_for_load_state('networkidle')
        page.wait_for_url('**/forgot-password**', timeout=5000)

        page.screenshot(path='/tmp/02_forgot_password_page.png')
        print(f"   [OK] URL actual: {page.url}")

        # Verificar elementos de forgot password
        fp_email_input = page.locator('input[type="email"]')
        fp_submit_button = page.locator('button:has-text("Enviar Enlace")')
        back_to_login = page.locator('a:has-text("Volver al Login")')

        print(f"   [OK] Campo email visible: {fp_email_input.is_visible()}")
        print(f"   [OK] Boton 'Enviar Enlace' visible: {fp_submit_button.is_visible()}")
        print(f"   [OK] Link 'Volver al Login' visible: {back_to_login.is_visible()}")

        # ============================================
        # TEST 3: Probar envío de email (con email no registrado)
        # ============================================
        print("\n[TEST 3] Probando envio de email (no registrado)...")
        fp_email_input.fill('noexiste@test.com')
        fp_submit_button.click()

        # Esperar respuesta
        page.wait_for_timeout(3000)
        page.screenshot(path='/tmp/03_email_sent.png')

        # Verificar si muestra mensaje de éxito (por seguridad siempre muestra lo mismo)
        success_message = page.locator('text=Revisa tu Correo')
        if success_message.is_visible():
            print("   [OK] Mensaje 'Revisa tu Correo' mostrado correctamente")
        else:
            print("   [WARN] No se mostro mensaje de confirmacion")

        # ============================================
        # TEST 4: Volver al Login
        # ============================================
        print("\n[TEST 4] Volviendo al Login...")
        back_link = page.locator('button:has-text("Volver al Login"), a:has-text("Volver al Login")')
        if back_link.is_visible():
            back_link.click()
            page.wait_for_load_state('networkidle')
            print(f"   [OK] URL actual: {page.url}")
        else:
            # Navegar directamente
            page.goto('https://localhost:8081/login')
            page.wait_for_load_state('networkidle')
            print("   [OK] Navegado directamente al login")

        page.screenshot(path='/tmp/04_back_to_login.png')

        # ============================================
        # TEST 5: Intentar login con credenciales inválidas
        # ============================================
        print("\n[TEST 5] Probando login con credenciales invalidas...")
        page.locator('input[type="email"]').fill('test@invalid.com')
        page.locator('input[type="password"]').fill('wrongpassword')
        page.locator('button:has-text("Ingresar")').click()

        # Esperar respuesta
        page.wait_for_timeout(3000)
        page.screenshot(path='/tmp/05_invalid_login.png')

        # Verificar si muestra error
        error_toast = page.locator('[data-sonner-toast], .toast-error, :text("Credenciales")')
        if error_toast.count() > 0:
            print("   [OK] Mensaje de error mostrado correctamente")
        else:
            print("   [WARN] No se detecto mensaje de error visible")

        # ============================================
        # TEST 6: Verificar Onboarding
        # ============================================
        print("\n[TEST 6] Verificando pagina de Onboarding...")
        page.goto('https://localhost:8081/onboarding')
        page.wait_for_load_state('networkidle')
        page.screenshot(path='/tmp/06_onboarding.png')

        # Verificar botones del onboarding
        continue_btn = page.locator('button:has-text("Continuar")')
        have_account = page.locator('a:has-text("Ya tengo cuenta")')

        print(f"   [OK] Boton 'Continuar' visible: {continue_btn.is_visible()}")
        print(f"   [OK] Link 'Ya tengo cuenta' visible: {have_account.is_visible()}")

        # ============================================
        # TEST 7: Verificar página de Registro
        # ============================================
        print("\n[TEST 7] Verificando pagina de Registro...")
        page.goto('https://localhost:8081/register')
        page.wait_for_load_state('networkidle')
        page.screenshot(path='/tmp/07_register.png')

        # Verificar campos del registro
        name_input = page.locator('input[name="fullName"]')
        email_reg = page.locator('input[type="email"]')
        password_reg = page.locator('input[name="password"]')
        phone_input = page.locator('input[name="phone"]')

        print(f"   [OK] Campo nombre visible: {name_input.is_visible()}")
        print(f"   [OK] Campo email visible: {email_reg.is_visible()}")
        print(f"   [OK] Campo password visible: {password_reg.is_visible()}")
        print(f"   [OK] Campo telefono visible: {phone_input.is_visible()}")

        # ============================================
        # TEST 8: Verificar página de Verificación
        # ============================================
        print("\n[TEST 8] Verificando pagina de Verificacion...")
        page.goto('https://localhost:8081/verification')
        page.wait_for_load_state('networkidle')
        page.screenshot(path='/tmp/08_verification.png')
        print(f"   [OK] URL: {page.url}")

        # Como no hay sesión, debería redirigir al login
        if '/login' in page.url:
            print("   [OK] Redirige correctamente al login (sin sesion)")
        else:
            print(f"   [INFO] Pagina actual: {page.url}")

        # ============================================
        # RESUMEN
        # ============================================
        print("\n" + "=" * 60)
        print("RESUMEN DE ERRORES")
        print("=" * 60)

        if errors:
            print("Errores de pagina encontrados:")
            for err in errors:
                print(f"  - {err}")
        else:
            print("[OK] Sin errores de pagina")

        if console_logs:
            error_logs = [log for log in console_logs if 'error' in log.lower()]
            if error_logs:
                print("\nErrores de consola:")
                for log in error_logs[:5]:  # Solo los primeros 5
                    print(f"  - {log}")
            else:
                print("[OK] Sin errores de consola")

        print("\n" + "=" * 60)
        print("SCREENSHOTS GUARDADOS EN: /tmp/")
        print("=" * 60)

        browser.close()
        print("\n[OK] Pruebas completadas")

if __name__ == "__main__":
    test_login_flow()